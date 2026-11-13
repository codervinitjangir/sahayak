"""Regression tests for the six defects found reviewing the 2026-11-13 commits.

Each test fails on the code as committed in 1041d82 / 4d04793 and passes on the
fix. Grouped in one file so the review and the fix can be read side by side.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.models.job import Job, JobAssignment
from app.models.payment import Payment
from app.models.vehicle import Vehicle
from app.schemas.payment import PaymentConfirmRequest, PaymentCreate
from app.services import job_service, payment_service, vehicle_service
from app.services.auth_service import Identity
from app.utils.errors import ConflictError, ForbiddenError, NotFoundError


def _pending(job_id: uuid.UUID, amount: str = "899.00") -> Payment:
    return Payment(
        id=uuid.uuid4(),
        job_id=job_id,
        amount=Decimal(amount),
        status="pending",
        payment_method="upi",
        created_at=datetime.now(timezone.utc),
    )


# --- 1. The payer must not be able to mark their own payment as paid ---------


@pytest.mark.asyncio
async def test_owner_cannot_confirm_own_payment():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    job_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job = Job(id=job_id, user_id=owner_id, status="completed")
    payment = _pending(job_id)
    update = AsyncMock()

    with patch("app.repositories.payment_repository.get_payment_by_id", return_value=payment), \
         patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.payment_repository.update_payment", update):
        with pytest.raises(ForbiddenError):
            await payment_service.confirm_payment(
                db, payment.id, PaymentConfirmRequest(gateway_ref_id="X"), identity
            )
    update.assert_not_called()


@pytest.mark.asyncio
async def test_assigned_partner_can_confirm_payment():
    db = AsyncMock()
    partner_id = uuid.uuid4()
    job_id = uuid.uuid4()
    identity = Identity(role="partner", local_id=partner_id, auth_user_id="auth-p")
    job = Job(id=job_id, user_id=uuid.uuid4(), status="completed")
    assignment = JobAssignment(id=uuid.uuid4(), job_id=job_id, partner_id=partner_id, status="completed")
    payment = _pending(job_id)
    paid = _pending(job_id)
    paid.status = "paid"
    paid.payment_method = "cash"

    with patch("app.repositories.payment_repository.get_payment_by_id", return_value=payment), \
         patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=assignment), \
         patch("app.repositories.payment_repository.update_payment", return_value=paid):
        res = await payment_service.confirm_payment(
            db, payment.id, PaymentConfirmRequest(payment_method="cash"), identity
        )
    assert res.status == "paid"


# --- 2. The amount comes from the job, never from the client ----------------


@pytest.mark.asyncio
async def test_create_payment_ignores_client_amount():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    job_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job = Job(id=job_id, user_id=owner_id, status="completed", price_final=Decimal("899.00"))
    create = AsyncMock(return_value=_pending(job_id))

    payload = PaymentCreate.model_validate(
        {"job_id": str(job_id), "amount": "1.00", "payment_method": "upi"}
    )
    with patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.payment_repository.get_latest_payment_for_job", return_value=None), \
         patch("app.repositories.payment_repository.create_payment", create):
        await payment_service.create_or_initiate_payment(db, payload, identity)

    assert create.await_args.kwargs["amount"] == Decimal("899.00")


@pytest.mark.asyncio
async def test_create_payment_refuses_job_without_price():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    job_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job = Job(id=job_id, user_id=owner_id, status="completed")
    create = AsyncMock()

    with patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.payment_repository.get_latest_payment_for_job", return_value=None), \
         patch("app.repositories.payment_repository.create_payment", create):
        with pytest.raises(ConflictError):
            await payment_service.create_or_initiate_payment(
                db, PaymentCreate(job_id=job_id), identity
            )
    create.assert_not_called()


# --- 3. Admin identities carry role "admin" ---------------------------------


@pytest.mark.asyncio
async def test_admin_can_read_job_payment():
    db = AsyncMock()
    job_id = uuid.uuid4()
    identity = Identity(role="admin", local_id=uuid.uuid4(), auth_user_id="auth-admin")
    job = Job(id=job_id, user_id=uuid.uuid4(), status="completed")

    with patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.payment_repository.get_latest_payment_for_job", return_value=_pending(job_id)):
        res = await payment_service.get_latest_job_payment(db, job_id, identity)
    assert res.job_id == job_id


# --- 6. GET must not write --------------------------------------------------


@pytest.mark.asyncio
async def test_get_job_payment_does_not_create_rows():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    job_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job = Job(id=job_id, user_id=owner_id, status="completed", price_final=Decimal("899.00"))
    create = AsyncMock()

    with patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.payment_repository.get_latest_payment_for_job", return_value=None), \
         patch("app.repositories.payment_repository.create_payment", create):
        with pytest.raises(NotFoundError):
            await payment_service.get_latest_job_payment(db, job_id, identity)
    create.assert_not_called()
    db.commit.assert_not_called()


# --- 4. Public tracking needs the owner's share token -----------------------


def _tracking_job(job_id: uuid.UUID) -> Job:
    return Job(
        id=job_id,
        user_id=uuid.uuid4(),
        status="assigned",
        service_id=1,
        vehicle_number="KA01AB1234",
        pickup_address_text="MG Road",
        requested_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_public_tracking_rejects_bare_job_id():
    """Knowing the job id (as every offered partner does) is not enough."""
    db = AsyncMock()
    job_id = uuid.uuid4()
    with patch("app.repositories.job_repository.get_job_by_id", return_value=_tracking_job(job_id)):
        with pytest.raises(NotFoundError):
            await job_service.get_public_job_tracking(db, job_id, "not-the-token")


@pytest.mark.asyncio
async def test_public_tracking_ignores_unanswered_offer():
    """An offered-but-not-accepted partner must not be shown as the rescuer."""
    db = AsyncMock()
    job_id = uuid.uuid4()
    token = job_service.share_token_for(job_id)
    get_partner = AsyncMock()

    with patch("app.repositories.job_repository.get_job_by_id", return_value=_tracking_job(job_id)), \
         patch("app.repositories.service_repository.get_service_by_id", return_value=None), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None), \
         patch("app.repositories.job_repository.get_latest_assignment",
               return_value=JobAssignment(id=uuid.uuid4(), job_id=job_id, partner_id=uuid.uuid4(), status="offered")), \
         patch("app.repositories.job_repository.get_partner_by_id", get_partner), \
         patch("app.services.job_service._pickup_coordinates", return_value=(12.97, 77.59)):
        res = await job_service.get_public_job_tracking(db, job_id, token)

    assert res.partner_name is None
    get_partner.assert_not_called()


def test_share_token_is_per_job():
    a, b = uuid.uuid4(), uuid.uuid4()
    assert job_service.share_token_for(a) != job_service.share_token_for(b)
    assert job_service.share_token_for(a) == job_service.share_token_for(a)


# --- 5. Deleting a vehicle with job history must not hit the FK -------------


@pytest.mark.asyncio
async def test_delete_vehicle_detaches_past_jobs_first():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    vehicle_id = uuid.uuid4()
    vehicle = Vehicle(id=vehicle_id, user_id=owner_id, vehicle_number="KA01AB1234")
    calls: list[str] = []

    async def detach(_db, vid):
        assert vid == vehicle_id
        calls.append("detach")

    async def delete(_db, vid):
        assert vid == vehicle_id
        calls.append("delete")

    with patch("app.repositories.vehicle_repository.get_vehicle_by_id", return_value=vehicle), \
         patch("app.repositories.vehicle_repository.has_active_jobs", return_value=False), \
         patch("app.repositories.vehicle_repository.detach_vehicle_from_jobs", side_effect=detach, create=True), \
         patch("app.repositories.vehicle_repository.delete_vehicle_by_id", side_effect=delete, create=True):
        res = await vehicle_service.delete_user_vehicle(db, vehicle_id, owner_id)

    assert calls == ["detach", "delete"]
    assert res["deleted"] is True
