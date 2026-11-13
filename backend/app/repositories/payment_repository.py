import uuid
from decimal import Decimal
from typing import Optional, Sequence
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payment import Payment


async def get_payment_by_id(
    db: AsyncSession, payment_id: uuid.UUID
) -> Optional[Payment]:
    """Fetch payment by primary key or return None."""
    result = await db.execute(select(Payment).where(Payment.id == payment_id))
    return result.scalar_one_or_none()


async def get_latest_payment_for_job(
    db: AsyncSession, job_id: uuid.UUID
) -> Optional[Payment]:
    """Fetch the newest payment record for a given job."""
    result = await db.execute(
        select(Payment)
        .where(Payment.job_id == job_id)
        .order_by(desc(Payment.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_payments_by_job_id(
    db: AsyncSession, job_id: uuid.UUID
) -> Sequence[Payment]:
    """Return all payment attempts for a job ordered newest first."""
    result = await db.execute(
        select(Payment)
        .where(Payment.job_id == job_id)
        .order_by(desc(Payment.created_at))
    )
    return result.scalars().all()


async def create_payment(
    db: AsyncSession,
    job_id: uuid.UUID,
    amount: Optional[Decimal] = None,
    payment_method: Optional[str] = None,
    gateway_ref_id: Optional[str] = None,
    status: str = "pending",
) -> Payment:
    """Insert a new payment row and flush it to the session."""
    payment = Payment(
        job_id=job_id,
        amount=amount,
        payment_method=payment_method,
        gateway_ref_id=gateway_ref_id,
        status=status,
    )
    db.add(payment)
    await db.flush()
    await db.refresh(payment)
    return payment


async def update_payment(
    db: AsyncSession, payment: Payment, **fields
) -> Payment:
    """Update fields on an existing payment row and flush."""
    for key, value in fields.items():
        setattr(payment, key, value)
    await db.flush()
    await db.refresh(payment)
    return payment



async def get_service_name(db: AsyncSession, service_id: int) -> Optional[str]:
    """Catalogue name for a receipt line."""
    from app.models.service import Service

    result = await db.execute(select(Service.name).where(Service.id == service_id))
    return result.scalar_one_or_none()
