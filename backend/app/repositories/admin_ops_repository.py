"""SQL for the admin back office: the live jobs board, owner management and the
audit log (ADR-024). Reads and flushes only; the service owns the transaction.

Every query here is ORM/Core with typed bind parameters, never raw text, so
asyncpg's PREPARE-before-bind never sees an untyped parameter.
"""
import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_audit import AdminAuditLog
from app.models.job import Job, JobAssignment, JobStatusHistory
from app.models.partner import Partner
from app.models.service import Service
from app.models.user import User

# Statuses the live board shows by default: everything a human might still
# need to act on. no_match_found is in it because a stranded owner whose
# search failed is exactly who support should call.
LIVE_JOB_STATUSES: tuple[str, ...] = (
    "requested", "matching", "assigned", "partner_en_route", "in_progress", "no_match_found",
)

# Assignment states that mean "this partner is or was on the job", newest wins;
# an unanswered offer is shown separately as `offered_partner`.
_RESPONSIBLE = ("accepted", "completed", "cancelled")


def _search(q: Optional[str], *columns):
    if not q:
        return None
    pattern = f"%{q.strip()}%"
    return or_(*[col.ilike(pattern) for col in columns])


async def list_jobs(
    db: AsyncSession,
    *,
    statuses: Sequence[str],
    q: Optional[str],
    limit: int,
    offset: int,
    no_match_after: Optional[datetime] = None,
) -> tuple[list[tuple[Job, Optional[str], Optional[str], Optional[str]]], int]:
    """Jobs newest first, with owner name, owner phone and service name.

    `q` matches owner name, owner phone, vehicle number or pickup address.
    Returns (rows, total) where each row is (job, owner_name, owner_phone, service_name).
    """
    base = (
        select(Job, User.name, User.phone, Service.name)
        .outerjoin(User, User.id == Job.user_id)
        .outerjoin(Service, Service.id == Job.service_id)
        .where(Job.status.in_(list(statuses)))
    )
    if no_match_after is not None:
        # ADR-036: an ended search drops off the live board after a while.
        base = base.where(or_(Job.status != "no_match_found", Job.requested_at > no_match_after))
    cond = _search(q, User.name, User.phone, Job.vehicle_number, Job.pickup_address_text)
    if cond is not None:
        base = base.where(cond)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    result = await db.execute(
        base.order_by(Job.requested_at.desc(), Job.id).limit(limit).offset(offset)
    )
    return [tuple(row) for row in result.all()], int(total)


async def partners_for_jobs(
    db: AsyncSession, job_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[Optional[str], Optional[str], Optional[str]]]:
    """{job_id: (assignment_status, partner_name, partner_phone)} for the newest
    assignment of each job. One query for the whole page, not one per row."""
    if not job_ids:
        return {}
    newest = (
        select(
            JobAssignment.job_id,
            JobAssignment.status,
            Partner.name,
            Partner.phone,
            func.row_number()
            .over(partition_by=JobAssignment.job_id, order_by=JobAssignment.offered_at.desc())
            .label("rn"),
        )
        .outerjoin(Partner, Partner.id == JobAssignment.partner_id)
        .where(JobAssignment.job_id.in_(list(job_ids)))
        .subquery()
    )
    result = await db.execute(
        select(newest.c.job_id, newest.c.status, newest.c.name, newest.c.phone).where(newest.c.rn == 1)
    )
    return {row[0]: (row[1], row[2], row[3]) for row in result.all()}


async def list_users(
    db: AsyncSession, *, q: Optional[str], limit: int, offset: int
) -> tuple[list[tuple[User, int]], int]:
    """Owners newest first with their job count. `q` matches name, phone or email."""
    job_count = (
        select(func.count(Job.id)).where(Job.user_id == User.id).correlate(User).scalar_subquery()
    )
    base = select(User, job_count.label("job_count"))
    cond = _search(q, User.name, User.phone, User.email)
    if cond is not None:
        base = base.where(cond)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    result = await db.execute(base.order_by(User.created_at.desc(), User.id).limit(limit).offset(offset))
    return [(row[0], int(row[1] or 0)) for row in result.all()], int(total)


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def count_jobs_for_user(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(select(func.count(Job.id)).where(Job.user_id == user_id))
    return int(result.scalar_one() or 0)


async def get_user_for_update(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id).with_for_update())
    return result.scalar_one_or_none()


async def add_audit(
    db: AsyncSession,
    *,
    admin_id: Optional[uuid.UUID],
    action: str,
    target_type: str,
    target_id: Optional[uuid.UUID],
    reason: Optional[str] = None,
    details: Optional[dict] = None,
) -> AdminAuditLog:
    row = AdminAuditLog(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        details=details,
    )
    db.add(row)
    await db.flush()
    return row


async def list_audit(
    db: AsyncSession,
    *,
    target_type: Optional[str],
    target_id: Optional[uuid.UUID],
    limit: int,
    offset: int,
) -> tuple[list[AdminAuditLog], int]:
    base = select(AdminAuditLog)
    if target_type:
        base = base.where(AdminAuditLog.target_type == target_type)
    if target_id:
        base = base.where(AdminAuditLog.target_id == target_id)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    result = await db.execute(
        base.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), int(total)


# ---------------------------------------------------------------------------
# Operational alerts (read-only; computed live, nothing stored - principle 1)
# ---------------------------------------------------------------------------
async def live_jobs_with_status_age(
    db: AsyncSession, *, statuses: Sequence[str], limit: int = 500
) -> Sequence[tuple[uuid.UUID, str, datetime, Optional[datetime]]]:
    """(job id, status, requested_at, when it last changed status) for live jobs.

    The last change is the newest job_status_history row. A job with no history
    row (should not exist, principle 4) falls back to requested_at in the service.
    """
    last_change = func.max(JobStatusHistory.changed_at)
    result = await db.execute(
        select(Job.id, Job.status, Job.requested_at, last_change)
        .outerjoin(JobStatusHistory, JobStatusHistory.job_id == Job.id)
        .where(Job.status.in_(tuple(statuses)))
        .group_by(Job.id, Job.status, Job.requested_at)
        .order_by(Job.requested_at)
        .limit(limit)
    )
    return [tuple(r) for r in result.all()]


async def job_status_counts_since(db: AsyncSession, since: datetime) -> dict[str, int]:
    """How many jobs requested since `since` are in each status now."""
    result = await db.execute(
        select(Job.status, func.count()).where(Job.requested_at >= since).group_by(Job.status)
    )
    return {status: int(n) for status, n in result.all()}


async def partner_duty_counts(db: AsyncSession) -> tuple[int, int]:
    """(verified partners on duty, verified partners in total)."""
    result = await db.execute(
        select(
            func.count().filter(Partner.is_available.is_(True)),
            func.count(),
        ).where(Partner.verification_status == "verified")
    )
    on_duty, total = result.one()
    return int(on_duty or 0), int(total or 0)


# --- ADR-043: leakage and fraud signals ---------------------------------------------

CANCELLED_BY_PARTNER_PREFIX = "Cancelled by partner"
UNVERIFIED_START_NOTE = "Start location not verified (no recent GPS fix)"
OWNER_SWAP_PREFIX = "Owner asked for another partner"


async def partner_risk_counts(db: AsyncSession, since: datetime) -> list[tuple[uuid.UUID, str, int, int, int]]:
    """Per partner since `since`: (id, name, cancels after work started,
    starts with no GPS fix, times an owner swapped them out for being late).

    "Cancelled after work started" is a partner cancellation on a job whose
    history already has 'in_progress': the start code was entered, so both
    were at the vehicle. Repeated, that is how "cancel in the app, pay me
    cash" looks from the data we hold.
    """
    h = JobStatusHistory
    started = select(h.job_id).where(h.status == "in_progress")
    accepted = (
        select(JobAssignment.job_id, JobAssignment.partner_id)
        .where(JobAssignment.accepted_at.is_not(None))
        .subquery()
    )
    cancel_after_start = func.count(func.distinct(h.job_id)).filter(
        h.status == "cancelled", h.note.like(f"{CANCELLED_BY_PARTNER_PREFIX}%"), h.job_id.in_(started))
    unverified = func.count(func.distinct(h.job_id)).filter(
        h.status == "in_progress", h.note == UNVERIFIED_START_NOTE)
    swapped = func.count(func.distinct(h.job_id)).filter(
        h.status == "matching", h.note.like(f"{OWNER_SWAP_PREFIX}%"))
    result = await db.execute(
        select(Partner.id, Partner.name, cancel_after_start, unverified, swapped)
        .select_from(h)
        .join(accepted, accepted.c.job_id == h.job_id)
        .join(Partner, Partner.id == accepted.c.partner_id)
        .where(h.changed_at >= since)
        .group_by(Partner.id, Partner.name)
    )
    return [(r[0], r[1], int(r[2] or 0), int(r[3] or 0), int(r[4] or 0)) for r in result.all()]


async def open_off_app_reports(db: AsyncSession) -> int:
    from app.models.dispute import JobDispute
    result = await db.execute(
        select(func.count()).select_from(JobDispute)
        .where(JobDispute.reason == "off_app_payment", JobDispute.status == "open"))
    return int(result.scalar_one() or 0)
