import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, envelope
from app.schemas.payment import (
    PaymentConfirmRequest,
    PaymentCreate,
    PaymentResponse,
)
from app.services import payment_service
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity

router = APIRouter(prefix=f"{API_V1_PREFIX}/payments", tags=["payments"])


@router.post(
    "",
    response_model=ApiResponse[PaymentResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Create or initiate a payment order for a job",
)
async def create_payment(
    payload: PaymentCreate,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PaymentResponse]:
    """Create a new payment order for an active or completed job.

    Supports UPI intent links and dynamic QR strings as well as cash payment
    records. Accessible to the job owner, assigned partner, or an ops administrator.
    """
    payment = await payment_service.create_or_initiate_payment(
        db, payload, identity
    )
    return envelope(payment)


@router.get(
    "/job/{job_id}",
    response_model=ApiResponse[PaymentResponse],
    status_code=status.HTTP_200_OK,
    summary="Get current payment status for a job",
)
async def get_job_payment(
    job_id: uuid.UUID,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PaymentResponse]:
    """Fetch the latest payment record for a given job.

    Creates an initial pending payment order if none exists yet. Accessible to the
    job owner, assigned partner, or administrator.
    """
    payment = await payment_service.get_latest_job_payment(db, job_id, identity)
    return envelope(payment)


@router.post(
    "/{payment_id}/confirm",
    response_model=ApiResponse[PaymentResponse],
    status_code=status.HTTP_200_OK,
    summary="Confirm settlement of a payment (UPI reference or Cash)",
)
async def confirm_payment(
    payment_id: uuid.UUID,
    payload: PaymentConfirmRequest,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PaymentResponse]:
    """Confirm that a pending payment order has been settled.

    Updates payment status to 'paid'. An already-settled payment returns 200
    idempotently.
    """
    payment = await payment_service.confirm_payment(
        db, payment_id, payload, identity
    )
    return envelope(payment)

