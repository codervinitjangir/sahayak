"""
Data-access layer for dispatch: candidate eligibility and job assignments.

Same contract as the other repositories — this module only talks to the
database. It builds queries, returns rows or ORM objects or None, raises no HTTP
errors, and never commits. What a missing row *means*, and where the transaction
boundary sits, belongs to app/services/dispatch_service.py.

The one thing worth reading closely is get_eligible_partners: it is the filter
that decides who is allowed to be offered a job at all, as opposed to who scores
well. Everything it enforces is a rule about safety or correctness — verified,
on shift, actually trained for this service, actually holding the equipment the
service needs — and none of it is negotiable by a good score.
"""
import uuid
from typing import Iterable, Optional, Sequence

from sqlalchemy import Row, and_, exists, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobAssignment
from app.models.partner import Partner, PartnerEquipment, PartnerService
from app.models.service import Service

# An assignment the partner has taken on. Note this is NOT the spec's literal
# ('accepted', 'in_progress'): job_assignments.status has a CHECK constraint
# allowing only ('offered','accepted','rejected','timed_out','completed',
# 'cancelled'), so 'in_progress' can never appear in that column — it is a *job*
# status. Filtering on it would have been a silent no-op that read as if it did
# something.
#
# The intent behind it is served by pairing this with ACTIVE_JOB_STATUSES below.
ACTIVE_ASSIGNMENT_STATUSES: tuple[str, ...] = ("accepted",)

# ...and the job it belongs to has not finished.
#
# Both halves now move: POST /jobs/{id}/status closes the assignment out to
# 'completed' or 'cancelled' when the job reaches a terminal state. The join is
# kept anyway, and it is not redundant — it is what makes the count correct
# when the two sides disagree. An assignment left at 'accepted' by a failed or
# partial write would otherwise occupy its partner forever, and the job status
# is the side that a human reading the database would trust.
#
# Historical note, because it explains the join's existence: before that
# endpoint there was no way to move an assignment off 'accepted' at all, so an
# assignment-only count would have treated every job a partner had ever
# finished as still occupying them, decaying their load_score permanently
# toward zero. See ADR-012.
ACTIVE_JOB_STATUSES: tuple[str, ...] = ("assigned", "partner_en_route", "in_progress")

# Equipment is only trusted once someone has checked it. A self-declared flatbed
# is a claim, not a flatbed.
VERIFIED = "verified"

# How many active jobs a partner may hold before dispatch stops offering them
# more.
#
# 2, and this is a filter rather than a score for a physical reason: one mechanic
# with one van can be in one place. The second job is defensible — it is the one
# they drive to next, and holding it stops the queue stalling while they finish —
# the third is a promise nobody can keep, and the customer waiting on it has no
# way to know they are third in line.
#
# load_score already prefers the idle partner, but a preference is not a limit:
# with the weights as they stand, a partner juggling four jobs 200 m away still
# outscores an idle one 6 km out. Without this ceiling the busiest partner in a
# dense area becomes the default answer for everything near them — which is
# exactly what a demo with more than a handful of test partners would surface,
# and exactly the kind of thing that looks like the algorithm "not working".
MAX_CONCURRENT_JOBS: int = 2


async def get_service_by_id(db: AsyncSession, service_id: int) -> Optional[Service]:
    """Fetch a services row by primary key, or None.

    Dispatch needs the row rather than just the id because of
    requires_vehicle_equipment, which decides whether the equipment filter
    applies at all.
    """
    result = await db.execute(select(Service).where(Service.id == service_id))
    return result.scalar_one_or_none()


async def get_job_coordinates(
    db: AsyncSession, job_id: uuid.UUID
) -> Optional[tuple[float, float]]:
    """Read a job's pickup point back as a plain (lat, lng) pair, or None.

    jobs.pickup_location is a PostGIS geography, which is not something the
    Redis client can be handed — so it gets unpacked here, in SQL, rather than
    by parsing WKB in Python.

    Written as explicit text because the ST_X/ST_Y pairing is the exact place
    this codebase keeps getting the axis order right on purpose: PostGIS stores
    a point as (x y) = (longitude latitude), so **ST_X is the longitude and
    ST_Y is the latitude**, the reverse of how a human quotes a coordinate. The
    cast to geometry is required because ST_X/ST_Y are not defined on geography.
    """
    result = await db.execute(
        text(
            "SELECT ST_Y(pickup_location::geometry) AS lat, "
            "       ST_X(pickup_location::geometry) AS lng "
            "FROM jobs WHERE id = :job_id"
        ),
        {"job_id": job_id},
    )
    row = result.first()
    if row is None or row.lat is None or row.lng is None:
        return None
    return float(row.lat), float(row.lng)


async def get_eligible_partners(
    db: AsyncSession,
    *,
    partner_ids: Iterable[uuid.UUID],
    service_id: int,
    requires_equipment: bool,
) -> Sequence[Row]:
    """Filter a set of partner ids down to those eligible for this service.

    partner_ids comes from the Redis radius search, so this is the second half
    of candidate selection: Redis answers "who is near", Postgres answers "who is
    allowed". Passing the ids in rather than scanning the whole partners table
    keeps the query proportional to the number of nearby partners.

    Every filter, and why it is a filter rather than a score:

      * ``is_available`` — a partner who is off shift has said they are not
        working. Offering them a job anyway would make the toggle a suggestion.
      * ``verification_status = 'verified'`` — an unverified mechanic has not had
        their identity or documents checked. This one is the difference between a
        platform and a stranger with your location.
      * a ``partner_services`` row for this exact service — no amount of being
        nearby makes someone a tow operator.
      * a **verified** ``partner_equipment`` row, when the service requires
        equipment — do not offer a towing job to someone without a verified
        flatbed. Note this checks that they hold verified equipment, not which
        kind: equipment_type is free text today (VARCHAR(40) with no vocabulary
        behind it), so matching a service to a specific type would be matching on
        a string somebody typed. That is a real gap and is left visible rather
        than papered over with a guess at the type names.
      * fewer than ``MAX_CONCURRENT_JOBS`` active jobs — a partner at capacity is
        not a worse choice, they are not a choice. See the constant for why this
        is a filter and not left to load_score.

    Returns rows of (id, name, rating_avg, rating_count, active_job_count).
    active_job_count is COUNTed here and stored nowhere — the same derived-data
    rule the rest of the codebase follows. A stored counter would need every
    accept, reject, completion and cancellation to remember to update it, and the
    first one that forgot would make a partner permanently over- or under-loaded
    with nothing to indicate why. It is returned as well as filtered on because
    the score needs the number, not just the verdict.
    """
    ids = list(partner_ids)
    if not ids:
        return []

    # Built once and used twice — once projected, once filtered on. Postgres
    # will evaluate it per candidate row in both places, which is affordable
    # precisely because ``ids`` is already bounded by the radius search. The
    # alternative (a derived table, or repeating the count in a HAVING) buys
    # nothing here and puts the eligibility rule further from the filters it
    # belongs with.
    active_job_count = (
        select(func.count(JobAssignment.id))
        .select_from(JobAssignment)
        .join(Job, Job.id == JobAssignment.job_id)
        .where(
            JobAssignment.partner_id == Partner.id,
            JobAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
            Job.status.in_(ACTIVE_JOB_STATUSES),
        )
        .correlate(Partner)
        .scalar_subquery()
    )

    offers_this_service = exists().where(
        and_(
            PartnerService.partner_id == Partner.id,
            PartnerService.service_id == service_id,
        )
    )

    statement = (
        select(
            Partner.id,
            Partner.name,
            Partner.rating_avg,
            Partner.rating_count,
            active_job_count.label("active_job_count"),
        )
        .where(
            Partner.id.in_(ids),
            Partner.is_available.is_(True),
            Partner.verification_status == VERIFIED,
            offers_this_service,
            active_job_count < MAX_CONCURRENT_JOBS,
        )
    )

    if requires_equipment:
        statement = statement.where(
            exists().where(
                and_(
                    PartnerEquipment.partner_id == Partner.id,
                    PartnerEquipment.verification_status == VERIFIED,
                )
            )
        )

    result = await db.execute(statement)
    return result.all()


async def set_job_status(db: AsyncSession, job: Job, status: str) -> Job:
    """Stage a job status change on an already-loaded job.

    Flush, not commit: every status change dispatch makes has a
    job_status_history row that must land in the same transaction, and the caller
    owns that boundary. A job whose status moved without a history entry is a job
    whose timeline lies.
    """
    job.status = status
    await db.flush()
    return job


async def create_assignment_row(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    partner_id: uuid.UUID,
    distance_at_offer_m: float,
    matching_score: float,
    score_components: dict,
    assignment_rank: int,
    was_baseline_choice: bool,
) -> JobAssignment:
    """Stage a job_assignments row offering a job to one partner.

    status and offered_at are left to the column defaults ('offered', now()) so
    the schema stays the single source of truth for what a fresh offer looks
    like, and so offered_at is stamped by the database clock — the same clock as
    every other timestamp it will later be compared against.

    matching_score is rounded to the column's NUMERIC(5,4) precision here rather
    than being handed to Postgres at full float width, so the value the
    evaluation report reads back is the value the ranking actually used.
    """
    assignment = JobAssignment(
        job_id=job_id,
        partner_id=partner_id,
        distance_at_offer_m=round(distance_at_offer_m, 2),
        matching_score=round(matching_score, 4),
        score_components=score_components,
        assignment_rank=assignment_rank,
        was_baseline_choice=was_baseline_choice,
    )
    db.add(assignment)
    await db.flush()
    return assignment


async def get_assignment_by_id(
    db: AsyncSession, assignment_id: uuid.UUID
) -> Optional[JobAssignment]:
    """Fetch a single job_assignments row by primary key, or None."""
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.id == assignment_id)
    )
    return result.scalar_one_or_none()


async def get_offered_partner_ids(
    db: AsyncSession, job_id: uuid.UUID
) -> set[uuid.UUID]:
    """Every partner who has already been offered this job, in any state.

    Every state, not just the rejections: a partner who let an offer time out, or
    who is holding one right now, must not be asked again either. This is what
    stops a rejection cascade from looping back to the partner who started it.
    """
    result = await db.execute(
        select(JobAssignment.partner_id)
        .where(JobAssignment.job_id == job_id)
        .where(JobAssignment.partner_id.is_not(None))
    )
    return {row[0] for row in result.all()}


async def get_max_assignment_rank(db: AsyncSession, job_id: uuid.UUID) -> int:
    """Highest assignment_rank issued for this job so far, or 0 if none.

    Read rather than counted, so the sequence survives a deleted row: rank is a
    record of "this was the Nth partner we asked", and re-issuing an N would make
    the offer history ambiguous.
    """
    result = await db.execute(
        select(func.coalesce(func.max(JobAssignment.assignment_rank), 0)).where(
            JobAssignment.job_id == job_id
        )
    )
    return int(result.scalar_one())


async def mark_assignment_accepted(
    db: AsyncSession, assignment: JobAssignment
) -> JobAssignment:
    """Stage an offer's acceptance.

    Both timestamps are set: responded_at is "when did they answer" and
    accepted_at is "when did they say yes". They are identical here and will not
    stay that way — a future timeout sweep sets responded_at on offers that were
    never accepted at all — so writing only one now would mean backfilling later.
    """
    assignment.status = "accepted"
    assignment.responded_at = func.now()
    assignment.accepted_at = func.now()
    await db.flush()
    return assignment


async def mark_assignment_rejected(
    db: AsyncSession, assignment: JobAssignment, rejection_reason: Optional[str]
) -> JobAssignment:
    """Stage an offer's rejection, with the partner's reason if they gave one."""
    assignment.status = "rejected"
    assignment.responded_at = func.now()
    if rejection_reason is not None:
        assignment.rejection_reason = rejection_reason
    await db.flush()
    return assignment
