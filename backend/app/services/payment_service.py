import logging
import uuid
from decimal import Decimal
from typing import Optional
from urllib.parse import quote
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.payment import Payment
from app.repositories import job_repository, payment_repository
from app.schemas.payment import (
    PaymentConfirmRequest,
    PaymentCreate,
    PaymentResponse,
)
from app.services.auth_service import Identity
from app.utils.errors import (
    BadRequestError,
    ConflictError,
    ErrorCode,
    NotFoundError,
)
from app.utils.logging import log_event

logger = logging.getLogger(__name__)

DEFAULT_UPI_VPA = "sahayak.dispatch@upi"
DEFAULT_UPI_PAYEE = "Sahayak Roadside Assistance"


def build_upi_intent_string(
    job_id: uuid.UUID,
    amount: Decimal,
    payee_vpa: str = DEFAULT_UPI_VPA,
    payee_name: str = DEFAULT_UPI_PAYEE,
) -> str:
    """Generate a standard UPI universal link for direct UPI app payments and QR codes.

    Format complies with NPCI UPI 2.0 URL specifications:
    upi://pay?pa={vpa}&pn={name}&am={amount}&cu=INR&tn={note}
    """
    short_id = str(job_id)[:8]
    note = f"Sahayak Roadside Help {short_id}"
    return (
        f"upi://pay?pa={quote(payee_vpa)}&pn={quote(payee_name)}"
        f"&am={amount:.2f}&cu=INR&tn={quote(note)}"
    )


def _to_payment_response(payment: Payment) -> PaymentResponse:
    upi_intent = None
    if payment.amount and payment.amount > 0 and payment.status == "pending":
        upi_intent = build_upi_intent_string(payment.job_id, payment.amount)

    return PaymentResponse(
        id=payment.id,
        job_id=payment.job_id,
        amount=payment.amount,
        status=payment.status,
        payment_method=payment.payment_method,
        gateway_ref_id=payment.gateway_ref_id,
        upi_intent=upi_intent,
        created_at=payment.created_at,
    )


async def _assert_job_access(
    db: AsyncSession, job_id: uuid.UUID, identity: Identity
) -> tuple[Job, bool, bool]:
    """Verify job exists and identity is authorized.

    Returns:
        (job, is_owner, is_partner)

    Raises:
        NotFoundError if job does not exist or caller is unauthorized (anti-enumeration).
    """
    job = await job_repository.get_job_by_id(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    is_admin = identity.role in ("ops", "super_admin")
    is_owner = identity.role == "user" and identity.local_id == job.user_id

    assignment = await job_repository.get_responsible_assignment(db, job.id)
    is_partner = (
        identity.role == "partner"
        and assignment is not None
        and assignment.partner_id == identity.local_id
    )

    if not (is_owner or is_partner or is_admin):
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    return job, is_owner, is_partner


async def get_latest_job_payment(
    db: AsyncSession, job_id: uuid.UUID, identity: Identity
) -> PaymentResponse:
    """Read the current payment record for a job, creating a pending row if none exists."""
    job, _, _ = await _assert_job_access(db, job_id, identity)

    payment = await payment_repository.get_latest_payment_for_job(db, job_id)
    if payment is None:
        # Determine base amount from job
        amount = job.price_final or job.price_estimate or Decimal("499.00")
        payment = await payment_repository.create_payment(
            db,
            job_id=job.id,
            amount=amount,
            payment_method="upi",
            status="pending",
        )
        await db.commit()

    return _to_payment_response(payment)


async def create_or_initiate_payment(
    db: AsyncSession, payload: PaymentCreate, identity: Identity
) -> PaymentResponse:
    """Create a new payment order or return existing active order."""
    job, _, _ = await _assert_job_access(db, payload.job_id, identity)

    if job.status in ("cancelled", "no_match_found"):
        raise ConflictError(
            ErrorCode.INVALID_PAYMENT_STATE,
            f"Cannot initiate payment for a job in '{job.status}' status",
        )

    # Check if existing payment is already settled
    latest = await payment_repository.get_latest_payment_for_job(db, job.id)
    if latest is not None and latest.status == "paid":
        return _to_payment_response(latest)

    # Calculate effective amount
    amount = payload.amount
    if amount is None or amount <= 0:
        amount = job.price_final or job.price_estimate or Decimal("499.00")

    payment_method = payload.payment_method or "upi"

    # If pending payment exists for same method and amount, reuse it
    if (
        latest is not None
        and latest.status == "pending"
        and latest.payment_method == payment_method
        and latest.amount == amount
    ):
        return _to_payment_response(latest)

    payment = await payment_repository.create_payment(
        db,
        job_id=job.id,
        amount=amount,
        payment_method=payment_method,
        gateway_ref_id=payload.gateway_ref_id,
        status="pending",
    )
    await db.commit()

    log_event(
        "payment_initiated",
        job_id=str(job.id),
        payment_id=str(payment.id),
        amount=float(amount),
        method=payment_method,
        initiated_by_role=identity.role,
    )

    return _to_payment_response(payment)


async def confirm_payment(
    db: AsyncSession,
    payment_id: uuid.UUID,
    payload: PaymentConfirmRequest,
    identity: Identity,
) -> PaymentResponse:
    """Mark a pending payment as paid upon UPI/Cash completion."""
    payment = await payment_repository.get_payment_by_id(db, payment_id)
    if payment is None:
        raise NotFoundError(ErrorCode.PAYMENT_NOT_FOUND, "Payment not found")

    job, is_owner, is_partner = await _assert_job_access(
        db, payment.job_id, identity
    )

    # Idempotent return if already paid
    if payment.status == "paid":
        return _to_payment_response(payment)

    if payment.status not in ("pending", "failed"):
        raise ConflictError(
            ErrorCode.INVALID_PAYMENT_STATE,
            f"Cannot confirm payment currently in '{payment.status}' status",
        )

    updates = {"status": "paid"}
    if payload.gateway_ref_id:
        updates["gateway_ref_id"] = payload.gateway_ref_id
    if payload.payment_method:
        updates["payment_method"] = payload.payment_method

    payment = await payment_repository.update_payment(db, payment, **updates)
    await db.commit()

    log_event(
        "payment_confirmed",
        job_id=str(job.id),
        payment_id=str(payment.id),
        amount=float(payment.amount) if payment.amount else 0.0,
        method=payment.payment_method,
        confirmed_by_role=identity.role,
    )

    return _to_payment_response(payment)
