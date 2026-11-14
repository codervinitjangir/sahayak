"""Phase 3 D (receipts) and E (disputes / refunds), ADR-027."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.models.dispute import JobDispute
from app.models.job import Job, JobAssignment
from app.models.partner import Partner
from app.models.payment import Payment
from app.schemas.dispute import DisputeCreate, DisputeResolve
from app.services import dispute_service, payment_service
from app.services.auth_service import Identity
from app.utils.errors import ConflictError, ErrorCode, NotFoundError

NOW = datetime.now(timezone.utc)


def _owner():
    return Identity(role="user", local_id=uuid.uuid4(), auth_user_id="a")


def _admin():
    return Identity(role="admin", local_id=uuid.uuid4(), auth_user_id="adm", admin_role="super_admin")


def _dispute(job_id, user_id, status="open"):
    return JobDispute(id=uuid.uuid4(), job_id=job_id, user_id=user_id, reason="overcharged",
                      description=None, status=status, created_at=NOW)


# ---------- disputes: owner side ----------

@pytest.mark.asyncio
async def test_open_dispute_on_someone_elses_job_is_404():
    ident = _owner()
    job = Job(id=uuid.uuid4(), user_id=uuid.uuid4(), status="completed")
    with patch("app.repositories.job_repository.get_job_by_id", return_value=job):
        with pytest.raises(NotFoundError):
            await dispute_service.open_dispute(AsyncMock(), job.id, DisputeCreate(reason="other"), ident)


@pytest.mark.asyncio
async def test_open_dispute_before_completion_is_409():
    ident = _owner()
    job = Job(id=uuid.uuid4(), user_id=ident.local_id, status="in_progress")
    with patch("app.repositories.job_repository.get_job_by_id", return_value=job):
        with pytest.raises(ConflictError) as exc:
            await dispute_service.open_dispute(AsyncMock(), job.id, DisputeCreate(reason="other"), ident)
    assert exc.value.code == ErrorCode.JOB_NOT_DISPUTABLE


@pytest.mark.asyncio
async def test_open_dispute_second_open_report_maps_unique_violation_to_409():
    ident = _owner()
    job = Job(id=uuid.uuid4(), user_id=ident.local_id, status="completed")
    db = AsyncMock()
    with patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.dispute_repository.create_dispute",
               side_effect=IntegrityError("x", {}, Exception("ux_job_disputes_one_open"))):
        with pytest.raises(ConflictError) as exc:
            await dispute_service.open_dispute(db, job.id, DisputeCreate(reason="damage"), ident)
    assert exc.value.code == ErrorCode.DISPUTE_ALREADY_OPEN
    db.rollback.assert_awaited()


@pytest.mark.asyncio
async def test_open_dispute_success_commits():
    ident = _owner()
    job = Job(id=uuid.uuid4(), user_id=ident.local_id, status="completed")
    db = AsyncMock()
    with patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.dispute_repository.create_dispute",
               return_value=_dispute(job.id, ident.local_id)):
        res = await dispute_service.open_dispute(db, job.id, DisputeCreate(reason="overcharged"), ident)
    assert res.status == "open"
    db.commit.assert_awaited_once()


def test_dispute_create_rejects_unknown_reason_and_extra_fields():
    with pytest.raises(ValidationError):
        DisputeCreate(reason="bad_vibes")
    with pytest.raises(ValidationError):
        DisputeCreate(reason="other", user_id=str(uuid.uuid4()))


def test_dispute_resolve_requires_a_note_and_cannot_reopen():
    with pytest.raises(ValidationError):
        DisputeResolve(resolution="resolved", note="")
    with pytest.raises(ValidationError):
        DisputeResolve(resolution="open", note="reopen it")


# ---------- disputes: staff side ----------

@pytest.mark.asyncio
async def test_resolve_closed_dispute_is_409():
    d = _dispute(uuid.uuid4(), uuid.uuid4(), status="rejected")
    with patch("app.repositories.dispute_repository.get_dispute_for_update", return_value=d):
        with pytest.raises(ConflictError) as exc:
            await dispute_service.resolve_dispute(
                AsyncMock(), d.id, DisputeResolve(resolution="resolved", note="done already"), _admin())
    assert exc.value.code == ErrorCode.DISPUTE_ALREADY_CLOSED


@pytest.mark.asyncio
async def test_refund_without_paid_payment_is_409_and_writes_nothing():
    d = _dispute(uuid.uuid4(), uuid.uuid4())
    audit = AsyncMock()
    with patch("app.repositories.dispute_repository.get_dispute_for_update", return_value=d), \
         patch("app.repositories.dispute_repository.get_paid_payment_for_update", return_value=None), \
         patch("app.repositories.admin_ops_repository.add_audit", audit):
        with pytest.raises(ConflictError) as exc:
            await dispute_service.resolve_dispute(
                AsyncMock(), d.id, DisputeResolve(resolution="refunded", note="refund"), _admin())
    assert exc.value.code == ErrorCode.INVALID_PAYMENT_STATE
    audit.assert_not_awaited()
    assert d.status == "open"


@pytest.mark.asyncio
async def test_refund_marks_payment_refunded_and_audits_in_one_commit():
    d = _dispute(uuid.uuid4(), uuid.uuid4())
    pay = Payment(id=uuid.uuid4(), job_id=d.job_id, amount=Decimal("899.00"), status="paid")
    audit = AsyncMock()
    db = AsyncMock()
    admin = _admin()
    with patch("app.repositories.dispute_repository.get_dispute_for_update", return_value=d), \
         patch("app.repositories.dispute_repository.get_paid_payment_for_update", return_value=pay), \
         patch("app.repositories.admin_ops_repository.add_audit", audit):
        res = await dispute_service.resolve_dispute(
            db, d.id, DisputeResolve(resolution="refunded", note="partner overcharged"), admin)
    assert pay.status == "refunded"
    assert res.status == "refunded"
    assert d.resolved_by == admin.local_id
    kwargs = audit.await_args.kwargs
    assert kwargs["action"] == "dispute_refunded" and kwargs["target_type"] == "dispute"
    assert kwargs["details"]["payment_id"] == str(pay.id)
    db.commit.assert_awaited_once()


# ---------- receipts ----------

def _job_with_owner(status="completed"):
    owner = _owner()
    job = Job(id=uuid.uuid4(), user_id=owner.local_id, status=status, service_id=1,
              vehicle_number="KA01AB1234", price_final=Decimal("899.00"))
    return owner, job


@pytest.mark.asyncio
async def test_receipt_for_pending_payment_is_409():
    owner, job = _job_with_owner()
    pay = Payment(id=uuid.uuid4(), job_id=job.id, amount=Decimal("899.00"), status="pending",
                  created_at=NOW)
    with patch("app.repositories.payment_repository.get_payment_by_id", return_value=pay), \
         patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None):
        with pytest.raises(ConflictError) as exc:
            await payment_service.get_receipt(AsyncMock(), pay.id, owner)
    assert exc.value.code == ErrorCode.INVALID_PAYMENT_STATE


@pytest.mark.asyncio
async def test_receipt_for_stranger_is_404():
    _, job = _job_with_owner()
    pay = Payment(id=uuid.uuid4(), job_id=job.id, amount=Decimal("899.00"), status="paid", created_at=NOW)
    with patch("app.repositories.payment_repository.get_payment_by_id", return_value=pay), \
         patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None):
        with pytest.raises(NotFoundError):
            await payment_service.get_receipt(AsyncMock(), pay.id, _owner())


@pytest.mark.asyncio
async def test_receipt_for_paid_payment_has_partner_and_service_and_no_tax_claim():
    owner, job = _job_with_owner()
    partner = Partner(id=uuid.uuid4(), name="Ravi Kumar")
    asg = JobAssignment(id=uuid.uuid4(), job_id=job.id, partner_id=partner.id, status="completed")
    pay = Payment(id=uuid.uuid4(), job_id=job.id, amount=Decimal("899.00"), status="paid",
                  payment_method="upi", gateway_ref_id="UTR123", created_at=NOW)
    with patch("app.repositories.payment_repository.get_payment_by_id", return_value=pay), \
         patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=asg), \
         patch("app.repositories.job_repository.get_partner_by_id", return_value=partner), \
         patch("app.repositories.payment_repository.get_service_name", return_value="Flat tyre"):
        r = await payment_service.get_receipt(AsyncMock(), pay.id, owner)
    assert r.receipt_number == f"SHY-{str(pay.id)[:8].upper()}"
    assert r.partner_name == "Ravi Kumar" and r.service_name == "Flat tyre"
    assert r.amount == Decimal("899.00") and r.payment_reference == "UTR123"
    assert r.is_tax_invoice is False
