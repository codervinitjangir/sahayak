"""SQL for job disputes and payment receipts. Never raises HTTP errors; flush only."""
import uuid
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dispute import JobDispute
from app.models.payment import Payment


async def create_dispute(
    db: AsyncSession, *, job_id: uuid.UUID, user_id: uuid.UUID, reason: str, description: Optional[str]
) -> JobDispute:
    row = JobDispute(job_id=job_id, user_id=user_id, reason=reason, description=description, status="open")
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def list_for_job(db: AsyncSession, job_id: uuid.UUID) -> list[JobDispute]:
    result = await db.execute(
        select(JobDispute).where(JobDispute.job_id == job_id).order_by(JobDispute.created_at.desc())
    )
    return list(result.scalars().all())


async def list_disputes(
    db: AsyncSession, *, status: Optional[str], limit: int, offset: int
) -> tuple[list[JobDispute], int]:
    base = select(JobDispute)
    if status:
        base = base.where(JobDispute.status == status)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    result = await db.execute(
        base.order_by(JobDispute.created_at.desc(), JobDispute.id).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), int(total)


async def get_dispute_for_update(db: AsyncSession, dispute_id: uuid.UUID) -> Optional[JobDispute]:
    result = await db.execute(select(JobDispute).where(JobDispute.id == dispute_id).with_for_update())
    return result.scalar_one_or_none()


async def get_paid_payment_for_update(db: AsyncSession, job_id: uuid.UUID) -> Optional[Payment]:
    result = await db.execute(
        select(Payment)
        .where(Payment.job_id == job_id, Payment.status == "paid")
        .order_by(Payment.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    return result.scalar_one_or_none()
