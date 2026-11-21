"""
Data-access layer for job ratings and the partner aggregate they feed.

Same contract as every other repository here: this module only talks to the
database, returns ORM objects, rows or None, raises no HTTP errors, and never
commits. Whether a missing rating *means* anything, and where the transaction
boundary sits, belongs to app/services/rating_service.py.

The aggregate maintained here — partners.rating_avg and rating_count — used to
be the job of a Postgres trigger, dropped in db/migrations/004 because it
resolved the rated partner through `job_assignments.status = 'accepted'` and a
job has already left that status by the time it can be rated. The replacement
deliberately does not repeat the trigger's other choice either: see
recompute_partner_rating for why the average is recomputed rather than
incremented. ADR-018.
"""
import uuid
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import JobAssignment
from app.models.partner import Partner
from app.models.rating import Rating
from app.repositories.job_repository import RESPONSIBLE_ASSIGNMENT_STATUSES


async def create_rating_row(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    rated_by: str,
    rating: int,
    comment: Optional[str],
) -> Rating:
    """Stage a ratings row and flush it so its generated id is available.

    The flush is what makes the UNIQUE (job_id, rated_by) constraint fire here
    rather than at commit, which matters to the caller: the service needs to
    catch that violation and turn it into a 409, and a constraint that only
    raises at commit time would surface after the aggregate had already been
    recomputed.

    rated_by arrives already decided by the service, which reads it from the
    verified token. This layer does not look at identity and would have no way
    to check it.

    created_at is left to the column default so Postgres, not this process,
    decides what "now" means.
    """
    row = Rating(job_id=job_id, rated_by=rated_by, rating=rating, comment=comment)
    db.add(row)
    await db.flush()
    return row


async def get_ratings_for_job(db: AsyncSession, job_id: uuid.UUID) -> List[Rating]:
    """Every rating on one job — at most two, one per side.

    Ordered by rated_by so the pair comes back in a stable order rather than in
    insertion order, which depends on which party got to it first and would make
    a response body differ between two jobs that are in the same state.

    Not filtered by who is asking. Visibility is a rule, and it lives in the
    service next to the participant check.
    """
    result = await db.execute(
        select(Rating).where(Rating.job_id == job_id).order_by(Rating.rated_by)
    )
    return list(result.scalars().all())


async def recompute_partner_rating(
    db: AsyncSession, partner_id: uuid.UUID
) -> Optional[Tuple[Decimal, int]]:
    """Rewrite one partner's rating_avg/rating_count from the ratings table.

    Returns the stored (rating_avg, rating_count) after the write, or None when
    no such partner row exists.

    **Recomputed from source, not incremented.** The trigger this replaces did
    `rating_avg = ((rating_avg * rating_count) + NEW.rating) / (rating_count + 1)`,
    which is one fewer table scan and wrong in two ways that only show up later:

      * partners.rating_avg is NUMERIC(2,1), so every incremental write rounds
        the running average to one decimal place and then uses that rounded
        value as the input to the next one. The error compounds. Recomputing
        from the raw rows rounds exactly once, at the end, so the stored value
        is always within half a decimal place of the truth no matter how many
        ratings preceded it.
      * an increment can only ever be as correct as the value it starts from. A
        row that is wrong — because a rating was deleted, corrected, or written
        during the window when the trigger was silently doing nothing — stays
        wrong forever. This query does not read the old value at all, so the
        next rating any partner receives repairs their row as a side effect.

    The cost is landed where it is affordable: this runs once per rating
    submitted, which is rare, and not on the dispatch path, which reads the
    column and is already round-trip bound (see the load-test report's §8.1).

    Two scalar subqueries rather than one aggregate joined in, so the ratings
    table is scanned twice. Deliberate: it keeps the statement readable and
    keeps the whole operation to a single round trip, and the alternative
    optimises a scan of a table with one row per completed job.

    Which ratings count toward a partner: those written by owners
    (`rated_by = 'user'`) on jobs where this partner holds the responsible
    assignment. RESPONSIBLE_ASSIGNMENT_STATUSES is imported from
    job_repository rather than restated, because "which assignment means this
    partner owns this job" is one rule with one home — the trigger's private
    copy of that rule getting out of step with it is the entire reason this
    function exists (ADR-012, ADR-018).
    """
    rated_jobs = (
        select(JobAssignment.job_id)
        .where(JobAssignment.partner_id == partner_id)
        .where(JobAssignment.status.in_(RESPONSIBLE_ASSIGNMENT_STATUSES))
    )

    owner_ratings = select(Rating).where(
        Rating.rated_by == "user", Rating.job_id.in_(rated_jobs)
    ).subquery()

    count_expression = select(func.count()).select_from(owner_ratings).scalar_subquery()
    # COALESCE because AVG over no rows is NULL, and a partner whose ratings were
    # all removed must return to the column default rather than to NULL —
    # scoring.rating_score reads NULL as "no evidence" but rating_count would
    # still say otherwise, and it documents that combination as a data fault.
    average_expression = (
        select(func.coalesce(func.avg(owner_ratings.c.rating), 0))
        .select_from(owner_ratings)
        .scalar_subquery()
    )

    result = await db.execute(
        update(Partner)
        .where(Partner.id == partner_id)
        .values(rating_count=count_expression, rating_avg=average_expression)
        .returning(Partner.rating_avg, Partner.rating_count)
    )
    row = result.fetchone()
    if row is None:
        return None
    return row[0], row[1]
