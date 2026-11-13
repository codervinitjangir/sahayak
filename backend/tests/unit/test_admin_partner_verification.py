"""
Unit tests for admin partner verification: listing roster and updating verification status.
"""
from datetime import datetime
from decimal import Decimal
import uuid
import pytest

from app.api.admin import list_partners, verify_partner
from pydantic import ValidationError
from app.schemas.admin import AdminPartnerVerificationRequest
from app.services.auth_service import Identity
from app.utils.errors import NotFoundError

ADMIN_IDENTITY = Identity(
    auth_user_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
    role="admin",
    local_id=uuid.UUID("99999999-9999-9999-9999-999999999999"),
)

PARTNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


class FakePartner:
    def __init__(
        self,
        partner_id: uuid.UUID = PARTNER_ID,
        phone: str = "+919811122334",
        name: str = "Ramesh Mechanic",
        business_name: str = "Speedy Repairs",
        verification_status: str = "pending",
        is_available: bool = True,
        rating_avg: Decimal = Decimal("4.8"),
        rating_count: int = 24,
    ):
        self.id = partner_id
        self.phone = phone
        self.name = name
        self.business_name = business_name
        self.verification_status = verification_status
        self.is_available = is_available
        self.rating_avg = rating_avg
        self.rating_count = rating_count
        self.verification_note = None
        self.created_at = datetime.utcnow()


class FakeSession:
    def __init__(self):
        self.committed = False
        self.refreshed = False

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        self.refreshed = True


import asyncio


def test_list_partners_returns_roster(monkeypatch):
    fake_partners = [
        FakePartner(verification_status="pending"),
        FakePartner(partner_id=uuid.uuid4(), phone="+919811122335", verification_status="verified"),
    ]

    async def fake_list(db, status=None):
        if status:
            return [p for p in fake_partners if p.verification_status == status]
        return fake_partners

    monkeypatch.setattr("app.repositories.partner_repository.list_partners", fake_list)

    # Call with no filter
    res = asyncio.run(list_partners(status_filter=None, identity=ADMIN_IDENTITY, db=FakeSession()))
    data = res["data"]
    assert data.total == 2
    assert len(data.items) == 2
    assert data.items[0].phone == "+919811122334"

    # Call with filter="pending"
    res_pending = asyncio.run(list_partners(status_filter="pending", identity=ADMIN_IDENTITY, db=FakeSession()))
    assert res_pending["data"].total == 1
    assert res_pending["data"].items[0].verification_status == "pending"


def test_verify_partner_updates_status(monkeypatch):
    partner = FakePartner(verification_status="pending")
    db = FakeSession()

    async def fake_update(db_session, partner_id, new_status, note=None):
        if partner_id == PARTNER_ID:
            partner.verification_status = new_status
            partner.verification_note = note
            return partner
        return None

    monkeypatch.setattr("app.repositories.partner_repository.update_partner_verification", fake_update)

    payload = AdminPartnerVerificationRequest(verification_status="verified")
    res = asyncio.run(verify_partner(PARTNER_ID, payload, identity=ADMIN_IDENTITY, db=db))

    assert res["data"].id == PARTNER_ID
    assert res["data"].verification_status == "verified"
    assert db.committed is True
    assert db.refreshed is True


def test_verify_partner_not_found_raises(monkeypatch):
    db = FakeSession()

    async def fake_update(db_session, partner_id, new_status, note=None):
        return None

    monkeypatch.setattr("app.repositories.partner_repository.update_partner_verification", fake_update)

    payload = AdminPartnerVerificationRequest(verification_status="verified")
    with pytest.raises(NotFoundError):
        asyncio.run(verify_partner(uuid.uuid4(), payload, identity=ADMIN_IDENTITY, db=db))



def test_reject_requires_a_reason():
    for status in ("rejected", "suspended"):
        for bad in (None, "", "  ", "ab"):
            with pytest.raises(ValidationError):
                AdminPartnerVerificationRequest(verification_status=status, notes=bad)


def test_reject_trims_reason_and_verify_drops_notes():
    r = AdminPartnerVerificationRequest(verification_status="rejected", notes="  RC expired ")
    assert r.notes == "RC expired"
    v = AdminPartnerVerificationRequest(verification_status="verified", notes="stray")
    assert v.notes is None


def test_reject_passes_reason_to_repository(monkeypatch):
    partner = FakePartner()
    db = FakeSession()
    seen = {}

    async def fake_update(db_session, partner_id, new_status, note=None):
        seen["note"] = note
        partner.verification_status = new_status
        partner.verification_note = note
        return partner

    monkeypatch.setattr("app.repositories.partner_repository.update_partner_verification", fake_update)
    payload = AdminPartnerVerificationRequest(verification_status="rejected", notes="Blurry licence")
    res = asyncio.run(verify_partner(PARTNER_ID, payload, identity=ADMIN_IDENTITY, db=db))
    assert seen["note"] == "Blurry licence"
    assert res["data"].verification_note == "Blurry licence"
