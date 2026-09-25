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

And one about concurrency, added 2026-09-23 (ADR-015): **anything that decides
whether a job may still be matched reads it through
job_repository.get_job_by_id_for_update()**, so the decision and the write it
authorises sit inside one row lock. That is respond_to_assignment() and
_offer_next(). dispatch_job() is deliberately excluded — it is the only path
that reaches Redis *between* reading the job and writing it, and a row lock held
across a call to another service turns one slow dependency into a queue of
blocked writers. It is also the one path with nothing to lose: it requires
'requested', a status no other endpoint can leave a job in.

The accept path takes a second lock, on the *partner* row, for the capacity
check added 2026-09-24 — two accepts by one partner for two different jobs share
no jobs row, so the jobs lock cannot order them. The order is jobs → partners →
job_assignments everywhere, and nothing in this codebase locks partners first.
See _require_capacity.
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
    DispatchUnavailableError,
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
# **Measured and logged, deliberately not enforced.** A partner whose phone last
# reported 20 minutes ago is still dispatched today, and an event is emitted
# instead of filtering them out, for two reasons: nothing pushes locations on a
# timer yet (there is no partner client — see the handoff doc), so a hard cutoff
# would empty every candidate set the moment the pilot started; and "stop
# offering work to a partner because their signal dropped" is a product decision
# about someone's earnings, not a detail to slip in under a matching change.
#
# Revisit when the partner client actually pings periodically: at that point a
# stale position means the app is closed or the signal is gone, which is real
# information, and enforcing this becomes a one-line change — made deliberately,
# by someone who has decided to make it. Until then the timestamp is recorded and
# the staleness is observable, which is the part that cannot be added
# retroactively.
MAX_LOCATION_AGE_S = 300

# The timeline note written when dispatch could not run at all, as opposed to
# running and finding nobody. Both end in 'no_match_found'; this string is the
# only thing that tells them apart, so it is a constant rather than a literal —
# the evaluation query matches on it. See mark_dispatch_unavailable and ADR-016.
DISPATCH_UNAVAILABLE_NOTE = (
    "Dispatch unavailable: could not reach the partner location service"
)


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
        InternalError (500): Redis is unreachable — specifically
            DispatchUnavailableError, a subclass that responds identically but
            can be caught apart from a failed write. Distinct from "nobody
            nearby" on purpose: one is a fact about the world, the other is a
            fact about our infrastructure, and recording an outage as "no
            partners available" would quietly corrupt the coverage metrics the
            pilot is being judged on. What the caller does with the distinction
            is ADR-016: the job still ends in 'no_match_found', because the
            driver's situation is the same either way, but the timeline entry
            says which of the two happened and the metrics split on it.
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
        raise DispatchUnavailableError(
            "Could not search for nearby partners right now."
        ) from exc

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

    Observation only — see MAX_LOCATION_AGE_S for why this does not filter.
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
        if age is None or age > MAX_LOCATION_AGE_S:
            log_event(
                "dispatch_stale_partner_location",
                level=logging.WARNING,
                job_id=str(job_id),
                partner_id=str(partner_id),
                location_age_s=round(age, 1) if age is not None else None,
                threshold_s=MAX_LOCATION_AGE_S,
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


async def mark_dispatch_unavailable(db: AsyncSession, job_id: uuid.UUID) -> bool:
    """Record that dispatch could not run for this job, so it stops being invisible.

    Called only from job_service._try_dispatch, and only for
    DispatchUnavailableError — the Redis location store not answering. Returns
    True if the job was moved, False if it had already left 'requested'.

    **The problem this solves.** Job creation triggers dispatch inside a guard,
    so a dispatch fault cannot fail a POST that genuinely succeeded. Until now
    the guard also left the job exactly where it was: 'requested', with no
    assignment, no history entry beyond "Job created", and no worker to come
    back for it. The load test produced these at a rate of about 0.08 %. Nothing
    anywhere said that a request had been dropped — the driver's app showed a
    live job and would have gone on showing it. A stranded customer with no
    assignment and no retry path is the worst failure this product has.

    **Why 'no_match_found' and not a new status.** Two reasons, one about the
    driver and one about cost. The driver's situation is identical in both
    cases — we did not get you a partner, please try again or call someone —
    and 'no_match_found' is already the status that says so, is already
    cancellable by the owner (ADR-013), and is already rendered by the client.
    A new status would be a CHECK-constraint migration, an entry in
    ALLOWED_TRANSITIONS, a decision about terminality, and a contract change for
    the frontend, for a path that is rarer than one job in a thousand and whose
    real fix is the re-dispatch worker that does not exist yet.

    **What keeps the two distinguishable** — which matters, because counting an
    outage as "no partners were available" would overstate a coverage problem
    the platform does not have — is the job_status_history note. Every entry
    written here says DISPATCH_UNAVAILABLE_NOTE and nothing else does, so the
    evaluation query splits on it:

        SELECT count(*) FROM job_status_history
        WHERE status = 'no_match_found' AND note LIKE 'Dispatch unavailable:%';

    That is the same mechanism ADR-013 already uses to carry the actor of a
    cancellation, for the same reason: the fact is recorded where it happened,
    rather than encoded in a status whose meaning every other consumer would
    then have to learn. See ADR-016.

    **No retry here.** Not a synchronous one, at least: retrying inside the
    request would block the driver's POST on a dependency that has just timed
    out, which is the one thing the guard exists to prevent. Recovery is the
    background sweep this codebase still does not have; what this function buys
    is that the sweep — or a human — has something to find.
    """
    job = await job_repository.get_job_by_id_for_update(db, job_id)
    if job is None or job.status != STATUS_REQUESTED:
        # Nothing to do, and not an error: the only other thing that can move a
        # job out of 'requested' this quickly is the owner cancelling it, whose
        # answer is the truer one. Locked read rather than a plain one so that
        # this check and the write below cannot be split (ADR-015).
        log_event(
            "dispatch_unavailable_not_recorded",
            level=logging.WARNING,
            job_id=str(job_id),
            job_status=job.status if job is not None else "missing",
            outcome="skipped",
        )
        return False

    await _transition(db, job, STATUS_NO_MATCH_FOUND, note=DISPATCH_UNAVAILABLE_NOTE)
    log_event(
        "dispatch_unavailable_recorded",
        level=logging.WARNING,
        job_id=str(job.id),
        job_status=STATUS_NO_MATCH_FOUND,
        reason="location_store_unavailable",
        outcome="success",
    )
    return True


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
    further offers are made for that job — unless the partner is already at
    MAX_CONCURRENT_JOBS, in which case the accept is refused with 409
    PARTNER_AT_CAPACITY and the job is passed to the next candidate exactly as a
    rejection would pass it. From the driver's side those two are the same event;
    only the partner is told the difference. See _require_capacity.

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

    The job is read with ``SELECT … FOR UPDATE`` and its status is checked
    *after* that lock is held, not before. See ADR-015: the assignment guard
    below closes the sequential cancel-then-accept case, because owner
    cancellation closes every 'offered' row it finds, but it cannot close the
    racing one — an owner cancelling at the same moment as a partner accepts
    had both transactions read a live job, both pass their checks, and the
    later commit win, resurrecting a cancelled job as 'assigned' and
    re-committing a mechanic to work the customer had explicitly called off.
    Locking the job row here puts the two transactions in a queue: one
    completes, the other re-reads the row it was blocked on and answers
    truthfully.

    Raises:
        NotFoundError (404): no assignment with this id.
        ForbiddenError (403): the offer belongs to a different partner.
        ConflictError (409) ASSIGNMENT_ALREADY_ANSWERED: already accepted,
            rejected or timed out. Usually a double tap on a slow connection.
            Also raised when the *job* has moved off 'matching' underneath a
            still-'offered' row — the same code deliberately, so a client
            cannot tell the racing case from the sequential one.
        ConflictError (409) PARTNER_AT_CAPACITY: accept only. The partner is
            already on MAX_CONCURRENT_JOBS jobs. The offer is left 'offered' and
            the job is re-dispatched. See _require_capacity.
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

    # Locking, not the polled read — and taken before the status check below,
    # which is the whole point (ADR-015). The lock is held until this
    # transaction ends, so it covers the decision *and* the write in _accept /
    # _reject, rather than just the write. It is taken for both branches: a
    # rejection also writes the job's history and can re-dispatch, so it has
    # the same interest in the job not vanishing mid-flight.
    job = await job_repository.get_job_by_id_for_update(db, assignment.job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    # 'matching' is the only status an answerable offer can coexist with:
    # dispatch_job() requires 'requested', commits the move to 'matching', and
    # only then creates the offer; the job stays 'matching' through an entire
    # rejection chain. So anything else here means the job moved underneath a
    # live offer — in practice an owner cancellation that committed first.
    #
    # ASSIGNMENT_ALREADY_ANSWERED rather than JOB_ALREADY_TERMINAL, and that is
    # a deliberate choice: whichever path moved the job also closed this
    # assignment, so by the time the client re-reads its offer list the row
    # will not say 'offered' either. Returning a different code purely because
    # our SELECT landed a few milliseconds before their UPDATE would make the
    # client's handling depend on timing. It is also honest — the offer has
    # been answered, by the job going away.
    if job.status != STATUS_MATCHING:
        log_event(
            "offer_answer_raced",
            level=logging.WARNING,
            assignment_id=str(assignment.id),
            job_id=str(job.id),
            partner_id=str(partner_id),
            job_status=job.status,
            attempted_action=action,
            outcome="failure",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise ConflictError(
            ErrorCode.ASSIGNMENT_ALREADY_ANSWERED,
            f"This job is no longer being matched (status: {job.status})",
        )

    if action == "accept":
        return await _accept(db, assignment, job, started)
    return await _reject(db, assignment, job, rejection_reason, started)


async def _accept(
    db: AsyncSession, assignment: JobAssignment, job: Job, started: float
) -> tuple[JobAssignment, Job, None]:
    """Accept an offer: the partner is committed and the job is assigned.

    The capacity check runs first and can end this call with a 409 — see
    _require_capacity. Everything after it is the write.
    """
    await _require_capacity(db, assignment, job, started)

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


async def _require_capacity(
    db: AsyncSession, assignment: JobAssignment, job: Job, started: float
) -> None:
    """Refuse an accept that would take the partner past MAX_CONCURRENT_JOBS.

    Returns silently when there is room. Otherwise it passes the job to the next
    candidate and raises 409 PARTNER_AT_CAPACITY.

    **Why this exists at all**, given that candidate selection already filters on
    the same number: the filter runs once, when the offer is made, and an
    'offered' assignment costs no capacity (ADR-008). Between those two moments
    the partner can accept any number of other offers, and nothing looked again.
    The dispatch load test found a partner holding four active jobs against a cap
    of two, and one breach at only four job creations per second — a missing
    check, not a narrow race. See the ADR-009 amendment.

    **Why the partner row is locked.** Counting under the job lock already held
    by respond_to_assignment() would not be enough: two offers to the same
    partner for two *different* jobs lock two different job rows, so neither
    transaction waits, both count the same pre-accept number, and both commit.
    The partner row is the only row those two transactions have in common, so it
    is the only thing that can order them. Under READ COMMITTED the count is a
    later statement with a fresh snapshot, so the one that waits sees the accept
    that went first. Lock order stays jobs → partners → job_assignments.

    **What a refusal does to the offer.** Nothing: it stays 'offered'. Being full
    is not declining, and writing 'rejected' here would charge a mechanic's
    acceptance rate for a limit the platform imposed on them — the same reasoning
    that gave owner cancellation its own assignment status in ADR-012. The
    consequence is that the job can briefly carry two live offers, the refused
    one and the re-dispatched one; the first of them to be accepted wins and the
    other gets the ordinary ASSIGNMENT_ALREADY_ANSWERED, which is exactly what
    already happens to any offer the job outruns.

    **Why the re-dispatch is guarded on rank.** Because the offer survives, the
    partner's app keeps showing it, and every retry would otherwise fire another
    re-dispatch: a new candidate per tap, the pool walked to exhaustion, and the
    job finally moved to 'no_match_found' while several partners still hold live
    offers for it. Re-offering only from the newest offer makes the refusal
    idempotent.
    """
    partner_id = assignment.partner_id

    locked = await dispatch_repository.lock_partner_for_update(db, partner_id)
    if locked is None:
        # job_assignments.partner_id is a foreign key, so this cannot happen
        # without the row having been deleted underneath a live offer. Say so and
        # carry on rather than inventing a 404 for the partner who is standing
        # there holding their phone: the count below is then 0, and letting them
        # take the job is the outcome that serves the stranded customer.
        log_event(
            "capacity_check_partner_missing",
            level=logging.WARNING,
            assignment_id=str(assignment.id),
            partner_id=str(partner_id),
            outcome="degraded",
        )

    active_job_count = await dispatch_repository.count_active_jobs(db, partner_id)
    if active_job_count < dispatch_repository.MAX_CONCURRENT_JOBS:
        return

    # Nothing has been written in this transaction; the commit is here to release
    # the two row locks — the job's, taken by respond_to_assignment(), and the
    # partner's, taken above — before _offer_next() reaches Redis. Holding a
    # Postgres lock across a call to another service is the thing this module
    # refuses to do anywhere (see _offer_next). It also mirrors _reject(): the
    # answer is settled first, the re-dispatch happens after.
    await db.commit()

    latest_rank = await dispatch_repository.get_max_assignment_rank(db, job.id)
    next_assignment = None
    if assignment.assignment_rank >= latest_rank:
        next_assignment = await _offer_next(db, job)

    log_event(
        "offer_refused_at_capacity",
        level=logging.WARNING,
        assignment_id=str(assignment.id),
        job_id=str(job.id),
        partner_id=str(partner_id),
        assignment_rank=assignment.assignment_rank,
        active_job_count=active_job_count,
        max_concurrent_jobs=dispatch_repository.MAX_CONCURRENT_JOBS,
        next_assignment_id=str(next_assignment.id) if next_assignment else None,
        outcome="rejected_partner_at_capacity",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    raise ConflictError(
        ErrorCode.PARTNER_AT_CAPACITY,
        "You are already working the maximum number of jobs "
        f"({dispatch_repository.MAX_CONCURRENT_JOBS}). This job has been offered "
        "to another partner.",
    )


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

    Also returns None *without* writing anything if the job stopped being
    'matching' while the candidate search was running — see the lock comment
    below.
    """
    already_offered = await dispatch_repository.get_offered_partner_ids(db, job.id)
    candidates = await find_candidates(db, job, exclude_partner_ids=already_offered)
    scored = score_candidates(candidates, job)

    # Lock here, and not at the top of this function: the candidate search above
    # makes a Redis round trip, and holding a Postgres row lock across a network
    # call to another service is how one slow dependency becomes a queue of
    # blocked writers. The same reasoning is why dispatch_job() takes no lock at
    # all. Locking *after* the search and immediately before the writes costs a
    # possibly-wasted search and keeps the lock window to two statements.
    #
    # The re-read is needed because _reject() committed — and so released the
    # lock taken in respond_to_assignment() — before calling us, deliberately,
    # so that a failing search cannot lose the partner's recorded "no". That
    # commit opens the same window ADR-015 is about: an owner cancelling in it
    # would otherwise get a fresh 'offered' row against a cancelled job, or
    # 'no_match_found' written over 'cancelled'. Abandoning the re-dispatch is
    # the right answer rather than an error: the rejection itself is already
    # committed and correct, there is simply no longer a job to re-offer.
    job = await job_repository.get_job_by_id_for_update(db, job.id)
    if job is None or job.status != STATUS_MATCHING:
        log_event(
            "matching_abandoned",
            level=logging.WARNING,
            job_id=str(job.id) if job is not None else None,
            job_status=job.status if job is not None else "missing",
            reason="job_left_matching_during_candidate_search",
            candidate_count=len(scored),
            outcome="success",
        )
        return None

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
