"""
Business rules for the two-way rating exchange at the end of a job.

An owner rates the mechanic who came out; the mechanic rates the owner. Both
write into the same `ratings` table and are told apart by `rated_by`, which is
read from the verified token and never from the request body — see
app/schemas/rating.py for why that distinction is load-bearing rather than
stylistic.

This module also owns `partners.rating_avg` and `partners.rating_count`, which
until now nothing in the system could write. A Postgres trigger was supposed to,
and could not: it looked up the rated partner through
`job_assignments.status = 'accepted'`, and a job has already moved that
assignment to 'completed' by the time it is legal to rate. The subquery returned
NULL at the only moment the trigger could fire. db/migrations/004 drops it and
ADR-018 records the reasoning, including why the aggregate is now recomputed
from source rather than incremented.

That matters beyond the ratings feature. ADR-009's matching score has four
weighted inputs and `rating_score` is one of them, reading exactly these two
columns. With nothing able to write them, every partner scored an identical
0.7 on that component forever — a fifth of the dispatch algorithm was a
constant, with nothing anywhere to say so.

**A stated gap, not an oversight:** the partner→owner direction is stored and
returned, but aggregated nowhere. `users` has no rating_avg/rating_count columns
and nothing in dispatch reads an owner's reputation, so there is nothing
truthful to compute yet. Adding columns nobody reads would be derived data
stored for its own sake, which core principle 1 exists to prevent. The rows are
kept because they are the evidence a later feature would be built from.
"""
import logging
import time
import uuid
from typing import List, Optional, Tuple

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rating import Rating
from app.repositories import dispatch_repository, job_repository, rating_repository
from app.schemas.rating import RatingCreateRequest
from app.services.auth_service import Identity
from app.utils.errors import (
    ConflictError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
)
from app.utils.logging import log_event

# The only job status a rating means anything from.
#
# Not a set, deliberately. 'cancelled' is the obvious candidate for a second
# member and is excluded on purpose: a cancelled job had no service in it, so a
# rating on one would be a rating of the cancellation — a different question,
# asked of a different party, with a different remedy — and letting it in here
# would put that answer into the same column the matching score averages.
RATEABLE_JOB_STATUS = "completed"


async def _resolve_participation(
    db: AsyncSession, job, identity: Identity
) -> Tuple[str, Optional[uuid.UUID]]:
    """Check the caller is a party to this job; return their side and the partner's id.

    Returns (rated_by, partner_id). partner_id is the partner who is responsible
    for the job — the one an owner's rating counts toward — or None when no
    assignment resolves one, which is a data fault rather than a normal state
    for a completed job.

    Raises ForbiddenError when the caller is neither the owner nor the
    responsible partner. Ownership is checked against the columns, never against
    anything the request supplied.
    """
    assignment = await job_repository.get_responsible_assignment(db, job.id)
    partner_id = assignment.partner_id if assignment is not None else None

    if identity.role == "user":
        if job.user_id != identity.local_id:
            raise ForbiddenError(
                ErrorCode.FORBIDDEN, "This job belongs to a different account"
            )
        return "user", partner_id

    # Partner. Role alone is not enough — require_partner establishes that the
    # caller is *a* mechanic, and this establishes that they are the one who did
    # the work. Same single message for "nobody accepted this job" and "someone
    # else did", for the reason job_service gives at the same check: both are
    # facts about someone else's job.
    if partner_id is None or partner_id != identity.local_id:
        raise ForbiddenError(
            ErrorCode.FORBIDDEN, "You are not the partner assigned to this job"
        )
    return "partner", partner_id


async def submit_rating(
    db: AsyncSession,
    job_id: uuid.UUID,
    payload: RatingCreateRequest,
    identity: Identity,
) -> Rating:
    """Record one side's rating of a finished job and refresh the aggregate.

    Order of checks is 404 → 403 → 409, matching every other job route (ADR-013):
    an unknown id is not confirmed to exist, a job that is not yours is not
    described, and only a caller who has passed both learns anything about the
    job's state.

    **The jobs row is read without a lock, unlike every other mutation that
    touches a job.** Core principle 7 asks for `get_job_by_id_for_update` on
    concurrency-sensitive mutations, and this one is not sensitive to that row:
    'completed' is terminal, so a read that sees it cannot stop being true, and a
    read that sees anything else produces a truthful 409 for the instant it was
    taken. Locking would put a write lock on the jobs row of every finished job
    for the duration of a rating, and buy nothing.

    **The partners row is locked, when there is one to update.** Two owners
    rating two different jobs of the same mechanic share no job row, so nothing
    else serialises them: both would recompute against a snapshot taken before
    the other's insert was visible and both would write the same count, losing
    one rating. The partner row is the only thing they have in common, and the
    recompute runs as a separate statement after the lock is granted, so under
    READ COMMITTED it takes a fresh snapshot that includes whichever insert went
    first. Same mechanism, and the same reasoning, as the accept-time capacity
    check (ADR-015).

    Lock ordering is unaffected: this path takes the partners lock and no other,
    so jobs → partners → job_assignments still holds by vacuity. The `ratings`
    insert follows the lock, which keeps the pattern "partners before anything
    we write" uniform across the codebase.

    No lock at all on the partner→owner direction, because there is no aggregate
    to update on that side. The UNIQUE (job_id, rated_by) constraint is the whole
    of its concurrency control, and it is enough.

    Args:
        db: session; this function owns the transaction and commits it.
        job_id: the job being rated, from the path.
        payload: the score and optional comment. Carries no identity.
        identity: verified caller, supplying both the actor and `rated_by`.

    Returns:
        The stored Rating row, refreshed so created_at is populated.

    Raises:
        NotFoundError (404): no job with this id.
        ForbiddenError (403): caller is not a party to this job.
        ConflictError (409): job is not completed, or this side already rated it.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    job = await job_repository.get_job_by_id(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    rated_by, partner_id = await _resolve_participation(db, job, identity)

    # Copied out of the ORM object before the transaction below, and used in
    # place of `job.<attr>` from here on.
    #
    # rollback() expires every object in the session — unconditionally, unlike
    # commit(), which AsyncSessionLocal opts out of with expire_on_commit=False.
    # Touching `job.id` in an except block therefore triggers an implicit lazy
    # load, and on an AsyncSession an implicit lazy load is not a slow query, it
    # is a MissingGreenlet: the failure handler raises, the ConflictError never
    # reaches the client, and a 409 is served as a 500. The logging is what
    # reads these, so the bug hides in exactly the branch least likely to be
    # exercised by hand.
    job_uuid: uuid.UUID = job.id
    job_status: str = job.status

    if job_status != RATEABLE_JOB_STATUS:
        log_event(
            "rating_submitted",
            level=logging.WARNING,
            job_id=str(job_uuid),
            rated_by=rated_by,
            job_status=job_status,
            outcome="rejected_job_not_completed",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise ConflictError(
            ErrorCode.JOB_NOT_RATEABLE,
            "Only a completed job can be rated",
        )

    # An owner's rating counts toward the mechanic who did the work. A completed
    # job always has a responsible assignment — it is how it reached 'completed'
    # — so None here is a data fault, and the choice is whether to refuse the
    # rating or store it with nothing to aggregate.
    #
    # Store it. Refusing would deny a legitimate rater because of a fault that is
    # not theirs and that they cannot clear, and the rating is not lost work:
    # because the aggregate is recomputed from this table rather than
    # incremented, repairing the assignment later makes this row count on the
    # partner's very next rating, with no backfill.
    aggregate_partner_id = partner_id if rated_by == "user" else None
    if rated_by == "user" and aggregate_partner_id is None:
        log_event(
            "rating_partner_unresolved",
            level=logging.WARNING,
            job_id=str(job_uuid),
            job_status=job_status,
            outcome="stored_without_aggregate",
        )

    try:
        if aggregate_partner_id is not None:
            # Before the insert, so two raters of the same mechanic queue here
            # rather than racing the recompute below.
            await dispatch_repository.lock_partner_for_update(db, aggregate_partner_id)

        row = await rating_repository.create_rating_row(
            db,
            job_id=job_uuid,
            rated_by=rated_by,
            rating=payload.rating,
            comment=payload.comment,
        )

        aggregate = None
        if aggregate_partner_id is not None:
            aggregate = await rating_repository.recompute_partner_rating(
                db, aggregate_partner_id
            )

        await db.commit()
    except IntegrityError:
        # UNIQUE (job_id, rated_by). Reached from the constraint rather than from
        # a SELECT before the insert, which is what makes it right when the same
        # person taps submit twice on a bad connection: a pre-check would let
        # both transactions past and the second would then fail at the database
        # with a 500 instead of this 409.
        await db.rollback()
        log_event(
            "rating_submitted",
            level=logging.WARNING,
            job_id=str(job_uuid),
            rated_by=rated_by,
            outcome="rejected_already_rated",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise ConflictError(
            ErrorCode.RATING_ALREADY_SUBMITTED,
            "You have already rated this job",
        )
    except SQLAlchemyError:
        await db.rollback()
        log_event(
            "rating_submitted",
            level=logging.ERROR,
            job_id=str(job_uuid),
            rated_by=rated_by,
            outcome="failure",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not save rating")

    # created_at is a server default, so it is not populated by the INSERT alone
    # and reading it would trigger a lazy refresh outside the async context.
    await db.refresh(row)

    log_event(
        "rating_submitted",
        job_id=str(job_uuid),
        rating_id=str(row.id),
        rated_by=rated_by,
        rating=row.rating,
        has_comment=row.comment is not None,
        partner_id=str(aggregate_partner_id) if aggregate_partner_id else None,
        # The aggregate after the write, so a log line answers "did the score
        # actually move" without a second query. This is the number ADR-009's
        # rating_score reads.
        partner_rating_avg=float(aggregate[0]) if aggregate else None,
        partner_rating_count=aggregate[1] if aggregate else None,
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return row


async def get_job_ratings(
    db: AsyncSession, job_id: uuid.UUID, identity: Identity
) -> Tuple[str, List[Rating], bool]:
    """Every rating on a job, plus whether this caller may still add one.

    Returns (job_status, ratings, can_rate).

    Both parties see both ratings, including the one written about them. That is
    a choice: a one-way mirror would need the rater hidden from the ratee, and
    with exactly two participants per job hiding the name changes nothing — each
    side already knows who the other is. Showing it keeps the mechanic's view of
    a job the same as the owner's, which is what makes a disagreement about a job
    a conversation about the same facts.

    `can_rate` is computed here rather than by the client so the rule that
    decides whether to show a rating form is the same rule that decides whether
    to accept one. A client re-deriving it drifts, and the failure is a form that
    submits into a 409.

    Raises:
        NotFoundError (404): no job with this id.
        ForbiddenError (403): caller is not a party to this job.
    """
    job = await job_repository.get_job_by_id(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    rated_by, _ = await _resolve_participation(db, job, identity)

    ratings = await rating_repository.get_ratings_for_job(db, job.id)
    already_rated = any(row.rated_by == rated_by for row in ratings)
    can_rate = job.status == RATEABLE_JOB_STATUS and not already_rated

    return job.status, ratings, can_rate
