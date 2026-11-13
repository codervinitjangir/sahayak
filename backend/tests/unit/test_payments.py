import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch
import pytest

from app.models.job import Job, JobAssignment
from app.models.payment import Payment
from app.schemas.payment import PaymentConfirmRequest, PaymentCreate
from app.services import payment_service
from app.services.auth_service import Identity
from app.utils.errors import ConflictError, NotFoundError


def test_build_upi_intent_string():
    job_id = uuid.uuid4()
    amount = Decimal("799.00")
    uri = payment_service.build_upi_intent_string(job_id, amount)
    assert uri.startswith("upi://pay?")
    assert "pa=sahayak.dispatch%40upi" in uri
    assert "am=799.00" in uri
    assert "cu=INR" in uri
    assert str(job_id)[:8] in uri


@pytest.mark.asyncio
async def test_get_latest_job_payment_job_not_found():
    db = AsyncMock()
    identity = Identity(role="user", local_id=uuid.uuid4(), auth_user_id="auth-1")
    job_id = uuid.uuid4()

    with patch("app.repositories.job_repository.get_job_by_id", return_value=None):
        with pytest.raises(NotFoundError):
            await payment_service.get_latest_job_payment(db, job_id, identity)


@pytest.mark.asyncio
async def test_get_latest_job_payment_creates_pending_if_none_exists():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job_id = uuid.uuid4()

    mock_job = Job(
        id=job_id,
        user_id=owner_id,
        status="completed",
        price_final=Decimal("899.00"),
    )
    mock_created_payment = Payment(
        id=uuid.uuid4(),
        job_id=job_id,
        amount=Decimal("899.00"),
        status="pending",
        payment_method="upi",
        created_at=datetime.now(timezone.utc),
    )

    with patch("app.repositories.job_repository.get_job_by_id", return_value=mock_job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.payment_repository.get_latest_payment_for_job", return_value=None), \
         patch("app.repositories.payment_repository.create_payment", return_value=mock_created_payment):

        res = await payment_service.get_latest_job_payment(db, job_id, identity)
        assert res.job_id == job_id
        assert res.amount == Decimal("899.00")
        assert res.status == "pending"
        assert res.payment_method == "upi"
        assert res.upi_intent is not None
        assert "am=899.00" in res.upi_intent


@pytest.mark.asyncio
async def test_create_or_initiate_payment_cancelled_conflict():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job_id = uuid.uuid4()

    mock_job = Job(id=job_id, user_id=owner_id, status="cancelled")

    with patch("app.repositories.job_repository.get_job_by_id", return_value=mock_job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None):

        payload = PaymentCreate(job_id=job_id, amount=Decimal("500.00"), payment_method="upi")
        with pytest.raises(ConflictError):
            await payment_service.create_or_initiate_payment(db, payload, identity)


@pytest.mark.asyncio
async def test_confirm_payment_success():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job_id = uuid.uuid4()
    payment_id = uuid.uuid4()

    mock_job = Job(id=job_id, user_id=owner_id, status="completed")
    mock_pending = Payment(
        id=payment_id,
        job_id=job_id,
        amount=Decimal("499.00"),
        status="pending",
        payment_method="upi",
        created_at=datetime.now(timezone.utc),
    )
    mock_paid = Payment(
        id=payment_id,
        job_id=job_id,
        amount=Decimal("499.00"),
        status="paid",
        payment_method="upi",
        gateway_ref_id="UPI-TXN-12345",
        created_at=datetime.now(timezone.utc),
    )

    with patch("app.repositories.payment_repository.get_payment_by_id", return_value=mock_pending), \
         patch("app.repositories.job_repository.get_job_by_id", return_value=mock_job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.payment_repository.update_payment", return_value=mock_paid):

        payload = PaymentConfirmRequest(gateway_ref_id="UPI-TXN-12345", payment_method="upi")
        res = await payment_service.confirm_payment(db, payment_id, payload, identity)
        assert res.id == payment_id
        assert res.status == "paid"
        assert res.gateway_ref_id == "UPI-TXN-12345"
        assert res.upi_intent is None  # no active upi intent when already paid

