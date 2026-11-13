"""SQL for the admin back office: the live jobs board, owner management and the
audit log (ADR-024). Reads and flushes only; the service owns the transaction.

Every query here is ORM/Core with typed bind parameters, never raw text, so
asyncpg's PREPARE-before-bind never sees an untyped parameter.
"""
import uuid
from typing import Optional, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_audit import AdminAuditLog
from app.models.job import Job, JobAssignment
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
    target_id: uuid.UUID,
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
