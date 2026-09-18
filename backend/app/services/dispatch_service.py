"""
The dispatch engine: who gets offered a job, and what happens when they answer.

Four functions, in the order a job moves through them:

  find_candidates      who *could* take this job      (Redis radius + SQL filters)
  score_candidates     who *should*                   (weighted ranking)
  dispatch_job         make the offer                 (jobs → matching, rank 1)
  respond_to_assignment  accept, or fall through to the next partner

Deliberately synchronous and API-triggered. There is no background worker, no
expiry sweep for offers nobody answers, and no notification — those are separate
tasks, and building half of one here would leave a timeout that fires from
nowhere with no way to observe it. Today an unanswered offer simply sits, and
that is visible in the data rather than hidden behind a scheduler that does not
exist.

Two rules this module holds to, because both are load-bearing elsewhere:

  * **Derived data is derived.** A partner's active job count is COUNTed at read
    time, never stored. See dispatch_repository.get_eligible_partners.
  * **Every job status change writes a job_status_history row in the same
    transaction.** A status that moved without a timeline entry is a job whose
    history lies, and the timeline is what the evaluation report reads.
"""
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Optional, Sequence

import redis.exceptions as redis_exceptions
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_client import (
    PARTNER_LOCATIONS_KEY,
    get_redis,
    location_updated_at_key,
)
from app.models.job import Job, JobAssignment
from app.repositories import dispatch_repository, job_repository
from app.utils.errors import (
    ConflictError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
)
from app.utils.logging import log_event
from app.utils.scoring import MAX_RADIUS_M, Candidate, baseline_pick, rank

# Job statuses this engine moves a job into. Named rather than inline so a
# typo is an ImportError instead of a row that fails a CHECK constraint at 3am.
STATUS_REQUESTED = "requested"
STATUS_MATCHING = "matching"
STATUS_ASSIGNED = "assigned"
STATUS_NO_MATCH_FOUND = "no_match_found"

# The rank given to the first partner asked. Ranks are 1-based because they are
# read by humans in the evaluation report: "we had to go to the 3rd partner"
# reads correctly, "the 2nd" for a zero-based 2 does not.
FIRST_ASSIGNMENT_RANK = 1

# How old a reported position may be before it is worth noticing.
#
# Not enforced. A partner whose phone last reported 20 minutes ago is currently
# still dispatched, and an event is logged instead of filtering them out, for
# two reasons: nothing pushes locations on a timer yet (there is no partner
# client — see the handoff doc), so a hard cutoff would empty every candidate
# set the moment the pilot started; and "stop offering work to a partner because
# their signal dropped" is a product decision about someone's earnings, not a
# detail to slip in under a matching change. The timestamp is recorded and the
# staleness is observable — turning that into a filter is a one-line change made
# deliberately, by someone who has decided to make it.
STALE_LOCATION_AFTER_S = 300


@dataclass(frozen=True)
class ScoredCandidate:
    """One candidate with everything needed to write their assignment row."""

    candidate: Candidate
    score: float
    components: dict[str, float]
    was_baseline_choice: bool


async def find_candidates(
    db: AsyncSession, job: Job, exclude_partner_ids: Optional[set] = None
) -> list[Candidate]:
    """Every partner who could legitimately take this job, nearest first.

    Two stages, in this order for a reason: Redis answers "who is within
    MAX_RADIUS_M of the pickup point" in one command over a set that is only
    ever as large as the active partner fleet, and Postgres then answers "and
    which of those is actually allowed" over a handful of ids. Doing it the
    other way — filter in SQL, then measure distance — would mean computing
    distances for every verified partner in the country.

    exclude_partner_ids drops partners who have already been offered this job.
    It exists for the rejection path: without it, the partner who just said no
    would score exactly as well as they did a second ago and be offered the same
    job again, forever.

    Returns [] when nobody qualifies. That is an answer, not a failure — see
    dispatch_job, where it becomes no_match_found.

    Raises:
        InternalError (500): Redis is unreachable. Distinct from "nobody nearby"
            on purpose: one is a fact about the world, the other is a fact about
            our infrastructure, and recording an outage as "no partners
            available" would quietly corrupt the coverage metrics the pilot is
            being judged on.
    """
    excluded = exclude_partner_ids or set()

    coordinates = await dispatch_repository.get_job_coordinates(db, job.id)
    if coordinates is None:
        # pickup_location is NOT NULL in the schema, so this means the row went
        # missing between the caller loading it and now.
        raise InternalError("Job pickup location is unavailable.")
    latitude, longitude = coordinates

    client = get_redis()
    try:
        # GEOSEARCH takes longitude first — the same axis order as the PostGIS
        # POINT(x y) convention used when the job was created. Swapping them
        # does not error; it searches somewhere else entirely.
        nearby = await client.geosearch(
            PARTNER_LOCATIONS_KEY,
            longitude=longitude,
            latitude=latitude,
            radius=MAX_RADIUS_M,
            unit="m",
            withdist=True,
            sort="ASC",
        )
    except redis_exceptions.RedisError as exc:
        log_event(
            "dispatch_location_store_unavailable",
            level=logging.ERROR,
            job_id=str(job.id),
            error_type=type(exc).__name__,
            outcome="failure",
        )
        raise InternalError("Could not search for nearby partners right now.") from exc

    # {partner_id: distance_m}, dropping anyone already asked.
    distances: dict[uuid.UUID, float] = {}
    for member, distance_m in nearby:
        try:
            partner_id = uuid.UUID(member)
        except (ValueError, AttributeError):
            # A member that is not a partner id means something else is writing
            # to this key. Skip it rather than failing the dispatch, but say so.
            log_event(
                "dispatch_unparseable_location_member",
                level=logging.WARNING,
                outcome="skipped",
            )
            continue
        if partner_id in excluded:
            continue
        distances[partner_id] = float(distance_m)

    if not distances:
        return []

    service = await dispatch_repository.get_service_by_id(db, job.service_id)
    if service is None:
        # jobs.service_id is a NOT NULL foreign key, so this is a broken
        # database rather than a bad request.
        raise InternalError("Job service is unavailable.")

    eligible = await dispatch_repository.get_eligible_partners(
        db,
        partner_ids=distances.keys(),
        service_id=job.service_id,
        requires_equipment=bool(service.requires_vehicle_equipment),
    )

    await _log_stale_locations(client, [row.id for row in eligible], job.id)

    candidates = [
        Candidate(
            partner_id=str(row.id),
            distance_m=distances[row.id],
            active_job_count=int(row.active_job_count or 0),
            rating_avg=float(row.rating_avg) if row.rating_avg is not None else 0.0,
            rating_count=int(row.rating_count or 0),
        )
        for row in eligible
    ]

    log_event(
        "dispatch_candidates_found",
        job_id=str(job.id),
        service_id=job.service_id,
        nearby_count=len(distances),
        eligible_count=len(candidates),
        excluded_count=len(excluded),
        radius_m=MAX_RADIUS_M,
        outcome="success",
    )
    return candidates


async def _log_stale_locations(client, partner_ids: Sequence, job_id: uuid.UUID) -> None:
    """Note any candidate whose reported position is older than the threshold.

    Observation only — see STALE_LOCATION_AFTER_S for why this does not filter.
    Failures here are swallowed: a dispatch must not fall over because a
    diagnostic lookup did.
    """
    if not partner_ids:
        return
    try:
        raw = await client.mget([location_updated_at_key(pid) for pid in partner_ids])
    except redis_exceptions.RedisError:
        return

    now = time.time()
    for partner_id, value in zip(partner_ids, raw):
        if value is None:
            age = None
        else:
            try:
                age = now - float(value)
            except (TypeError, ValueError):
                age = None
        if age is None or age > STALE_LOCATION_AFTER_S:
            log_event(
                "dispatch_stale_partner_location",
                level=logging.WARNING,
                job_id=str(job_id),
                partner_id=str(partner_id),
                location_age_s=round(age, 1) if age is not None else None,
                threshold_s=STALE_LOCATION_AFTER_S,
                enforced=False,
                outcome="noted",
            )


def score_candidates(candidates: list[Candidate], job: Job) -> list[ScoredCandidate]:
    """Rank candidates best-first and mark which one the naive baseline picked.

    The ranking itself lives in app/utils/scoring.py, which is pure arithmetic
    with no database behind it — that separation is what lets the weighting be
    tested and re-tuned without standing a job up.

    What this function adds is the baseline comparison. The nearest candidate is
    computed *independently* of the score, over the same candidate set, and
    exactly that one row is flagged was_baseline_choice. Every other row is
    flagged false rather than left null, so "false" means "we checked and the
    naive strategy disagreed" — which is the whole point, since the divergence
    rate is counted off this column and a null would be indistinguishable from a
    row written before the column existed.

    Note the flag marks the *candidate*, not the winner: when the top-scored
    partner is also the nearest, rank 1 carries was_baseline_choice true and the
    engine agreed with the baseline on this job. When the nearest partner is
    ranked third, rank 1 carries false — the weighting changed the outcome, and
    that is the case the metric is looking for.

    job is taken but not read today. It is the argument the next version needs:
    a job's service, its price band or the time of day are all plausible inputs
    to a weighting, and threading it now means that change does not have to
    touch every caller.
    """
    if not candidates:
        return []

    baseline_partner_id = baseline_pick(candidates)
    ranked = rank(candidates)
    return [
        ScoredCandidate(
            candidate=candidate,
            score=total,
            components=components,
            was_baseline_choice=str(candidate.partner_id) == str(baseline_partner_id),
        )
        for total, components, candidate in ranked
    ]


async def dispatch_job(db: AsyncSession, job_id: uuid.UUID) -> Optional[JobAssignment]:
    """Find, score and offer a job to the single best partner.

    One offer, not a broadcast. Offering to everyone at once would get a job
    accepted faster and would also mean five mechanics driving toward one
    breakdown and four of them wasting a trip — so the engine asks the best
    candidate, and falls through to the next only when that one declines. The
    cost of that choice is latency on a rejection, which is what a future
    timeout sweep is for.

    Outcomes:
      * candidates found → job moves to 'matching', a rank-1 offer is created,
        and the assignment is returned.
      * no candidates → job moves to 'no_match_found' and None is returned.
        **This is not an error.** Nobody being available at 4am in a thinly
        covered area is a normal thing for this platform to discover, and the
        driver needs to be told so they can call someone else. Raising here
        would turn a real answer into a 500 and lose the status entirely.

    Both outcomes write a job_status_history row in the same transaction as the
    status change.

    Raises:
        NotFoundError (404): no job with this id.
        ConflictError (409) JOB_ALREADY_DISPATCHED: the job has already left
            'requested'. This is what makes the call safe to retry — a second
            dispatch of an assigned job would offer it to a second partner.
        InternalError (500): Redis unreachable, or the write failed.
    """
    started = time.perf_counter()

    job = await job_repository.get_job_by_id(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    if job.status != STATUS_REQUESTED:
        log_event(
            "dispatch_started",
            level=logging.WARNING,
            job_id=str(job_id),
            job_status=job.status,
            outcome="rejected_already_dispatched",
        )
        raise ConflictError(
            ErrorCode.JOB_ALREADY_DISPATCHED,
            f"Job has already been dispatched (status: {job.status})",
        )

    candidates = await find_candidates(db, job)
    scored = score_candidates(candidates, job)

    if not scored:
        await _transition(
            db,
            job,
            STATUS_NO_MATCH_FOUND,
            note="No available partner within search radius",
        )
        log_event(
            "no_match",
            job_id=str(job.id),
            service_id=job.service_id,
            radius_m=MAX_RADIUS_M,
            outcome="success",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        return None

    best = scored[0]
    await _transition(db, job, STATUS_MATCHING, note="Searching for a partner")
    assignment = await _create_offer(
        db, job=job, scored=best, assignment_rank=FIRST_ASSIGNMENT_RANK
    )

    log_event(
        "matching_started",
        job_id=str(job.id),
        assignment_id=str(assignment.id),
        partner_id=str(best.candidate.partner_id),
        candidate_count=len(scored),
        matching_score=round(best.score, 4),
        was_baseline_choice=best.was_baseline_choice,
        assignment_rank=FIRST_ASSIGNMENT_RANK,
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return assignment


async def respond_to_assignment(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    partner_id: uuid.UUID,
    action: str,
    rejection_reason: Optional[str] = None,
) -> tuple[JobAssignment, Job, Optional[JobAssignment]]:
    """Record a partner's answer to an offer, and re-dispatch if they declined.

    Returns (answered_assignment, job, next_assignment). next_assignment is the
    offer made to the following partner after a rejection, or None — either
    because the partner accepted, or because there was nobody left to ask.

    On accept: the offer becomes 'accepted' and the job becomes 'assigned'. No
    further offers are made for that job.

    On reject: the offer becomes 'rejected', the candidate search runs again
    excluding **every partner already offered this job** — not merely the one
    rejecting — and the next-best partner gets an offer at rank previous + 1. If
    nobody is left, the job becomes 'no_match_found'. The job stays in 'matching'
    throughout a rejection chain, because from the driver's point of view nothing
    has changed: we are still looking.

    Ownership is checked here rather than in the route for the same reason as
    partner_service._require_own_profile: it is a rule about who may answer an
    offer, and a rule that only exists in an HTTP handler is one a background job
    can walk straight past. Depends(require_partner) establishes that the caller
    is *a* partner; this establishes that they are *this* partner. Without it any
    mechanic holding a valid token could accept work offered to a competitor.

    Raises:
        NotFoundError (404): no assignment with this id.
        ForbiddenError (403): the offer belongs to a different partner.
        ConflictError (409) ASSIGNMENT_ALREADY_ANSWERED: already accepted,
            rejected or timed out. Usually a double tap on a slow connection.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    assignment = await dispatch_repository.get_assignment_by_id(db, assignment_id)
    if assignment is None:
        raise NotFoundError(ErrorCode.ASSIGNMENT_NOT_FOUND, "Assignment not found")

    if assignment.partner_id != partner_id:
        log_event(
            "assignment_access_denied",
            level=logging.WARNING,
            assignment_id=str(assignment_id),
            actor_partner_id=str(partner_id),
            outcome="failure",
        )
        raise ForbiddenError(
            code=ErrorCode.FORBIDDEN,
            message="This offer was made to a different partner.",
        )

    if assignment.status != "offered":
        raise ConflictError(
            ErrorCode.ASSIGNMENT_ALREADY_ANSWERED,
            f"This offer has already been answered (status: {assignment.status})",
        )

    job = await job_repository.get_job_by_id(db, assignment.job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    if action == "accept":
        return await _accept(db, assignment, job, started)
    return await _reject(db, assignment, job, rejection_reason, started)


async def _accept(
    db: AsyncSession, assignment: JobAssignment, job: Job, started: float
) -> tuple[JobAssignment, Job, None]:
    """Accept an offer: the partner is committed and the job is assigned."""
    try:
        await dispatch_repository.mark_assignment_accepted(db, assignment)
        await _transition(
            db, job, STATUS_ASSIGNED, note="Partner accepted the job", commit=False
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "offer_accepted",
            level=logging.ERROR,
            assignment_id=str(assignment.id),
            job_id=str(job.id),
            outcome="failure",
            error_type=type(exc).__name__,
        )
        raise InternalError("Could not accept this offer") from exc

    await db.refresh(assignment)
    await db.refresh(job)

    log_event(
        "offer_accepted",
        assignment_id=str(assignment.id),
        job_id=str(job.id),
        partner_id=str(assignment.partner_id),
        assignment_rank=assignment.assignment_rank,
        job_status=job.status,
        actor_role="partner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return assignment, job, None


async def _reject(
    db: AsyncSession,
    assignment: JobAssignment,
    job: Job,
    rejection_reason: Optional[str],
    started: float,
) -> tuple[JobAssignment, Job, Optional[JobAssignment]]:
    """Reject an offer and immediately try the next-best partner.

    The rejection is committed before the re-dispatch is attempted. That
    ordering is deliberate: if the candidate search then fails — Redis down,
    database blip — the partner's "no" has still been recorded, and a retry
    picks up from a correct state rather than re-offering the job to the person
    who just declined it.
    """
    try:
        await dispatch_repository.mark_assignment_rejected(db, assignment, rejection_reason)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "offer_rejected",
            level=logging.ERROR,
            assignment_id=str(assignment.id),
            job_id=str(job.id),
            outcome="failure",
            error_type=type(exc).__name__,
        )
        raise InternalError("Could not record this response") from exc

    await db.refresh(assignment)

    log_event(
        "offer_rejected",
        assignment_id=str(assignment.id),
        job_id=str(job.id),
        partner_id=str(assignment.partner_id),
        assignment_rank=assignment.assignment_rank,
        actor_role="partner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )

    next_assignment = await _offer_next(db, job)
    await db.refresh(job)
    return assignment, job, next_assignment


async def _offer_next(db: AsyncSession, job: Job) -> Optional[JobAssignment]:
    """Offer a job to the best partner who has not been asked yet.

    Returns the new assignment, or None when the candidate pool is exhausted —
    in which case the job lands in 'no_match_found', the same terminal state a
    job with no candidates at all reaches. A driver whose job was declined by
    every nearby mechanic and a driver for whom none were nearby are in the same
    position and need the same answer.
    """
    already_offered = await dispatch_repository.get_offered_partner_ids(db, job.id)
    candidates = await find_candidates(db, job, exclude_partner_ids=already_offered)
    scored = score_candidates(candidates, job)

    if not scored:
        await _transition(
            db,
            job,
            STATUS_NO_MATCH_FOUND,
            note="No remaining partner accepted the job",
        )
        log_event(
            "no_match",
            job_id=str(job.id),
            reason="candidate_pool_exhausted",
            offered_count=len(already_offered),
            outcome="success",
        )
        return None

    best = scored[0]
    next_rank = await dispatch_repository.get_max_assignment_rank(db, job.id) + 1
    assignment = await _create_offer(
        db, job=job, scored=best, assignment_rank=next_rank
    )

    log_event(
        "matching_retried",
        job_id=str(job.id),
        assignment_id=str(assignment.id),
        partner_id=str(best.candidate.partner_id),
        assignment_rank=next_rank,
        candidate_count=len(scored),
        matching_score=round(best.score, 4),
        was_baseline_choice=best.was_baseline_choice,
        outcome="success",
    )
    return assignment


async def _create_offer(
    db: AsyncSession, *, job: Job, scored: ScoredCandidate, assignment_rank: int
) -> JobAssignment:
    """Write one offer row and commit it.

    Separate from _transition so the job's status change and the offer can share
    a transaction when they happen together (dispatch) and not when they do not
    (a retry after a rejection, where the status is already 'matching').
    """
    try:
        assignment = await dispatch_repository.create_assignment_row(
            db,
            job_id=job.id,
            partner_id=uuid.UUID(str(scored.candidate.partner_id)),
            distance_at_offer_m=scored.candidate.distance_m,
            matching_score=scored.score,
            score_components=scored.components,
            assignment_rank=assignment_rank,
            was_baseline_choice=scored.was_baseline_choice,
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "dispatch_offer_failed",
            level=logging.ERROR,
            job_id=str(job.id),
            outcome="failure",
            error_type=type(exc).__name__,
        )
        raise InternalError("Could not create the job offer") from exc

    await db.refresh(assignment)
    return assignment


async def _transition(
    db: AsyncSession, job: Job, status: str, *, note: str, commit: bool = True
) -> None:
    """Move a job to a new status and record it in the timeline, atomically.

    The pairing is the point: these two writes are never allowed to come apart,
    so they are never written apart. commit=False lets a caller fold this into a
    larger transaction (accept, where the assignment changes too) without
    letting it skip the history row.
    """
    try:
        await dispatch_repository.set_job_status(db, job, status)
        await job_repository.create_status_history_row(
            db, job_id=job.id, status=status, note=note
        )
        if commit:
            await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "job_status_transition_failed",
            level=logging.ERROR,
            job_id=str(job.id),
            target_status=status,
            outcome="failure",
            error_type=type(exc).__name__,
        )
        raise InternalError("Could not update the job status") from exc
