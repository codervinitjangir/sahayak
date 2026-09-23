"""
Data-access layer for job creation and job detail reads.

Everything here only talks to the database: it builds and executes queries and
returns ORM objects (or None). It deliberately does not raise HTTP errors and
does not commit — deciding what a missing row *means*, and where the
transaction boundary sits, belongs to app/services/job_service.py.
"""
import uuid
from typing import Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobAssignment, JobStatusHistory
from app.models.partner import Partner
from app.models.service import Service

# get_vehicle_by_id used to live here, because job creation was the only caller
# that had ever needed to read a vehicle. It now lives in
# app/repositories/vehicle_repository.py alongside the rest of the vehicle SQL.
# Moved rather than duplicated: job creation's ownership check and GET
# /vehicles/{id}'s 404 must agree about what "this vehicle" means, and two copies
# of the same SELECT are how they would stop agreeing.


async def get_service_by_code(
    db: AsyncSession, service_code: str
) -> Optional[Service]:
    """Resolve a service code (e.g. "flat_tyre") to its services row.

    Clients send codes rather than integer ids so the public API stays stable
    even when services.id values differ between environments.
    """
    result = await db.execute(select(Service).where(Service.code == service_code))
    return result.scalar_one_or_none()


async def create_job_row(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    vehicle_id: uuid.UUID,
    vehicle_number: Optional[str],
    service_id: int,
    status: str,
    pickup_location: object,
    pickup_address_text: Optional[str] = None,
    issue_description: Optional[str] = None,
) -> Job:
    """Stage a new jobs row and flush it so its generated id is available.

    Flush rather than commit: the matching job_status_history row has to land in
    the same transaction, so the caller owns the commit.
    """
    job = Job(
        user_id=user_id,
        vehicle_id=vehicle_id,
        vehicle_number=vehicle_number,
        service_id=service_id,
        status=status,
        pickup_location=pickup_location,
        pickup_address_text=pickup_address_text,
        issue_description=issue_description,
    )
    db.add(job)
    await db.flush()
    return job


async def create_status_history_row(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    status: str,
    note: Optional[str] = None,
) -> JobStatusHistory:
    """Stage a job_status_history row for a job that just changed state.

    changed_at is stamped by the database (now()) rather than by the API
    process, so every entry in the audit trail is on one clock.
    """
    entry = JobStatusHistory(
        job_id=job_id,
        status=status,
        changed_at=func.now(),
        note=note,
    )
    db.add(entry)
    await db.flush()
    return entry


async def get_job_by_id(db: AsyncSession, job_id: uuid.UUID) -> Optional[Job]:
    """Fetch a single job by primary key, or None when no such row exists.

    The non-locking read, and the one that must stay non-locking. This is what
    GET /jobs/{job_id} uses, and that endpoint is polled — a tracking screen
    asks it every few seconds for the whole life of a job. If this took a row
    lock, every poll would queue behind every in-flight mutation of the same
    job and vice versa, turning a read that costs nothing into the slowest part
    of the system precisely when the job is busiest. Postgres' MVCC means a
    plain SELECT never waits on a row lock, so a poll during a completion sees
    the pre-commit state instantly rather than blocking to see the post-commit
    one. For a status display that is the correct trade.

    Callers that intend to *write* the row they just read want
    get_job_by_id_for_update() instead.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    return result.scalar_one_or_none()


async def get_job_by_id_for_update(
    db: AsyncSession, job_id: uuid.UUID
) -> Optional[Job]:
    """Fetch a single job by primary key under a row lock, or None if absent.

    The same query as get_job_by_id() plus SELECT ... FOR UPDATE. It exists
    because read-check-write on a job row is a lost update whenever two
    requests do it at once, and the pair that actually collides in this product
    is a partner completing a job at the same moment its owner cancels it: both
    read 'assigned', both find their transition legal, both write. The loser's
    write lands second and wins, so a completed job silently becomes cancelled
    (or the reverse) with two history rows and no error anywhere. See ADR-013.

    Three things about this that are not visible in the one line of code:

    1. **The lock is held until the transaction ends, not until this returns.**
       That is the whole mechanism. Because the callers here fetch the job as
       the first statement of the transaction that will update it, the check
       ("is this transition legal from the current status") and the write are
       inside the same lock, which is what makes them one atomic decision. A
       lock released before the check would buy nothing.
    2. **The second transaction re-reads the row when the lock is granted.**
       Under READ COMMITTED — Postgres' default, and what this project runs —
       a FOR UPDATE that blocks does not resume with its original snapshot; it
       re-reads the latest committed version of the row before locking it.
       So the loser sees the winner's status, not the stale one it queued with,
       and returns an honest 409 instead of overwriting. Worth knowing that
       this is *specific* to READ COMMITTED: under REPEATABLE READ the same
       statement would abort with a serialization failure (40001) and the
       callers would need retry logic, which they do not have.
    3. **populate_existing is not decoration.** If this job were already in the
       session's identity map, SQLAlchemy would return the previously loaded
       object and leave its attributes alone, so the query would take the lock
       and still hand back the stale status — safe-looking and wrong, the worst
       of both. Today every caller runs this before any other read of the job,
       so the identity map is empty and it makes no difference; it is here so
       the function stays correct if that stops being true.

    Callers must take this lock *before* touching job_assignments, and all of
    them do. Consistent ordering is what keeps two concurrent job mutations
    from deadlocking against each other over the same two tables.
    """
    result = await db.execute(
        select(Job)
        .where(Job.id == job_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_status_history(
    db: AsyncSession, job_id: uuid.UUID
) -> Sequence[JobStatusHistory]:
    """Fetch a job's full status trail, oldest first.

    Ascending order because the caller renders it as a timeline. id is a
    secondary sort key only to keep the order stable when two transitions share
    a changed_at timestamp; it carries no meaning of its own.
    """
    result = await db.execute(
        select(JobStatusHistory)
        .where(JobStatusHistory.job_id == job_id)
        .order_by(JobStatusHistory.changed_at.asc(), JobStatusHistory.id.asc())
    )
    return result.scalars().all()


async def get_latest_assignment(
    db: AsyncSession, job_id: uuid.UUID
) -> Optional[JobAssignment]:
    """Fetch the newest job_assignments row for a job, or None if never offered.

    A job can accumulate several assignment rows as the dispatcher retries after
    rejections and timeouts. Only the most recent offer describes where the job
    stands right now, so we order by offered_at descending and take one.
    """
    result = await db.execute(
        select(JobAssignment)
        .where(JobAssignment.job_id == job_id)
        .order_by(JobAssignment.offered_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_partner_by_id(
    db: AsyncSession, partner_id: uuid.UUID
) -> Optional[Partner]:
    """Fetch a single partner by primary key, or None when no such row exists."""
    result = await db.execute(select(Partner).where(Partner.id == partner_id))
    return result.scalar_one_or_none()


# The assignment states that mean "this partner took this job on".
#
# All three descend from an acceptance: an assignment only reaches 'completed'
# or 'cancelled' by having been 'accepted' first and then closed out by a
# lifecycle transition. The other three states in the CHECK constraint —
# 'offered', 'rejected', 'timed_out' — mean the partner was *asked*, which
# confers nothing.
#
# The closed-out states are in here rather than just 'accepted' because
# authorisation asks "whose job is this", and that answer does not stop being
# true when the job finishes. Matching on 'accepted' alone made the partner who
# had just completed a job a stranger to it one millisecond later, so their
# next request was refused with 403 ("you are not assigned to this job") in
# place of the truthful 409 ("this job is finished"). See ADR-012.
RESPONSIBLE_ASSIGNMENT_STATUSES: tuple[str, ...] = (
    "accepted",
    "completed",
    "cancelled",
)


async def get_responsible_assignment(
    db: AsyncSession, job_id: uuid.UUID
) -> Optional[JobAssignment]:
    """Fetch the assignment a partner actually took on for this job, or None.

    Deliberately not get_latest_assignment: the newest row is whoever was asked
    most recently, which after a rejection chain is frequently an offer nobody
    has answered. An accepted row — live or since closed out — is the only one
    that says who is responsible for the job, and it is what a lifecycle
    transition has to be checked against.

    At most one row can match in practice — dispatch stops offering a job once
    an offer is accepted, and both closed-out states are terminal for the job —
    but the query does not depend on that being true. Ordering by accepted_at
    descending means that if a data fault ever did produce two, the later one
    wins rather than the result being arbitrary.
    """
    result = await db.execute(
        select(JobAssignment)
        .where(JobAssignment.job_id == job_id)
        .where(JobAssignment.status.in_(RESPONSIBLE_ASSIGNMENT_STATUSES))
        .order_by(JobAssignment.accepted_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# The assignment states that are still live — a partner is either being asked
# or is on their way.
#
# The complement of RESPONSIBLE_ASSIGNMENT_STATUSES on one axis and its overlap
# on another, which is why both exist and neither is derived from the other.
# 'accepted' is in both: it is the only state that is simultaneously "this
# partner owns the job" and "this is not finished". 'offered' is here but not
# there, because being asked confers no authority — but it does have to be
# closed when the job goes away underneath it. 'completed' and 'cancelled' are
# there but not here: already closed, nothing to do.
#
# Used by owner cancellation, which has to release whoever is currently on the
# hook without caring whether they had answered yet.
OPEN_ASSIGNMENT_STATUSES: tuple[str, ...] = ("offered", "accepted")


async def get_open_assignments(
    db: AsyncSession, job_id: uuid.UUID
) -> Sequence[JobAssignment]:
    """Fetch every still-live assignment for a job — offered or accepted.

    Plural, and that is not defensive padding. At most one row should be open
    at a time: dispatch offers a job to one partner, and moves on only after
    that offer is rejected or times out, both of which close the row. But
    "should" is doing work there that a UNIQUE constraint is not, and the cost
    of the assumption being wrong is a job_assignments row left reading
    'offered' against a job that no longer exists for anyone — a partner whose
    app still shows the offer, and who can still tap accept on it.

    Returning a sequence means the caller closes all of them without having to
    know whether the invariant held. Ordered oldest first only so the result is
    stable across calls; nothing depends on the order.
    """
    result = await db.execute(
        select(JobAssignment)
        .where(JobAssignment.job_id == job_id)
        .where(JobAssignment.status.in_(OPEN_ASSIGNMENT_STATUSES))
        .order_by(JobAssignment.offered_at.asc())
    )
    return result.scalars().all()


# The columns a lifecycle transition is allowed to touch.
#
# update_job_fields is generic, which is what keeps the branching ("does this
# status need a price?") in the service where it belongs instead of leaking
# into the repository as a pile of optional keyword flags. The price of a
# generic setter is that it would otherwise write *any* attribute, including
# user_id or pickup_location, so the allowlist is what stops it becoming a back
# door the next time someone reaches for a convenient writer.
_MUTABLE_LIFECYCLE_FIELDS = frozenset(
    {"status", "price_final", "completed_at", "cancelled_at", "cancellation_reason"}
)


async def update_job_fields(db: AsyncSession, job: Job, **fields: object) -> Job:
    """Stage lifecycle column updates on an already-loaded job, then flush.

    Flush, not commit: a status change always travels with a
    job_status_history row, and frequently with an assignment update too. The
    caller owns the transaction boundary so those cannot come apart.

    Raises ValueError — not an HTTP error — for a field outside the allowlist.
    That is a programming mistake, not a request the client got wrong, and it
    should surface as a 500 with a stack trace rather than be dressed up as
    something the caller could fix.
    """
    unknown = set(fields) - _MUTABLE_LIFECYCLE_FIELDS
    if unknown:
        raise ValueError(
            f"update_job_fields cannot write {sorted(unknown)}; "
            f"allowed: {sorted(_MUTABLE_LIFECYCLE_FIELDS)}"
        )

    for name, value in fields.items():
        setattr(job, name, value)
    await db.flush()
    return job


async def set_assignment_status(
    db: AsyncSession, assignment: JobAssignment, status: str
) -> JobAssignment:
    """Stage a status change on an already-loaded assignment, then flush.

    No timestamp is written alongside it. job_assignments has offered_at,
    responded_at and accepted_at — all three describe the *offer* negotiation,
    and none of them means "the work finished". Reusing responded_at to mean
    that would make "how long did partners take to answer offers?" unanswerable
    from the column that exists to answer it. When a completed_at is genuinely
    needed on the assignment it should be its own column; the job already
    carries the timestamp today.
    """
    assignment.status = status
    await db.flush()
    return assignment
