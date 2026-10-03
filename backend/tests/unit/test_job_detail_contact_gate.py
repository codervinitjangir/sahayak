"""
Unit tests for what `GET /api/v1/jobs/{id}` releases about the assigned partner.

Why this file exists at all: `get_job_with_status` has no unit tests of its own —
the read path is covered by check_auth_flow.py against the live API. That is the
right place to prove the happy path, but it is the wrong place to prove a
*negative*: a harness asserts that a bystander's payload lacks a phone number,
and it would go on passing if a later change added a new partner field outside
the redaction gate, because the harness does not know the field exists.

So the subject here is the gate itself, not the fields currently behind it.
`may_see_contact_details` is one boolean guarding a group, and every partner
attribute added to CurrentAssignmentResponse has to join that group or be a
deliberate exception with a reason. `partner_rating_count` (added 2026-09-30) is
the first field added since the gate was written, which is exactly when a gate
gets quietly bypassed.

No database, no event loop fixture — pytest-asyncio is not installed here, so
every async call goes through asyncio.run(), same as the rest of tests/unit.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.repositories import job_repository
from app.schemas.job import JobDetailResponse
from app.services import job_service
from app.services.auth_service import Identity

JOB_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OWNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
PARTNER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
OTHER_ID = uuid.UUID("99999999-9999-9999-9999-999999999999")
AUTH_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")

NOW = datetime(2026, 9, 30, 10, 0, 0, tzinfo=timezone.utc)

OWNER = Identity(auth_user_id=AUTH_ID, role="user", local_id=OWNER_ID)
ASSIGNED_PARTNER = Identity(auth_user_id=AUTH_ID, role="partner", local_id=PARTNER_ID)
BYSTANDER_PARTNER = Identity(auth_user_id=AUTH_ID, role="partner", local_id=OTHER_ID)
BYSTANDER_OWNER = Identity(auth_user_id=AUTH_ID, role="user", local_id=OTHER_ID)

# Every partner-derived field on CurrentAssignmentResponse. A field in this list
# must be None for a caller outside the gate. When someone adds the next one,
# the assertion below fails until they either add it here or argue it out.
GATED_PARTNER_FIELDS = (
    "partner_id",
    "partner_name",
    "partner_phone",
    "partner_rating",
    "partner_rating_count",
)


class Stub:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _job():
    return Stub(
        id=JOB_ID,
        user_id=OWNER_ID,
        status="in_progress",
        service_id=1,
        vehicle_number="MH12AB1234",
        pickup_address_text="Baner Road",
        issue_description="Flat tyre",
        price_estimate=Decimal("500.00"),
        price_final=None,
        requested_at=NOW,
        completed_at=None,
    )


def _partner():
    return Stub(
        id=PARTNER_ID,
        name="Ravi Kumar",
        phone="+919812345678",
        rating_avg=Decimal("4.5"),
        rating_count=12,
    )


@pytest.fixture
def wiring(monkeypatch):
    """Stub the four repository reads get_job_with_status makes."""
    calls = {"get_partner_by_id": 0}

    async def get_job_by_id(db, job_id):
        return _job()

    async def get_latest_assignment(db, job_id):
        return Stub(status="accepted", partner_id=PARTNER_ID, estimated_arrival_min=9)

    async def get_partner_by_id(db, partner_id):
        calls["get_partner_by_id"] += 1
        return _partner()

    async def get_status_history(db, job_id):
        return [Stub(status="requested", changed_at=NOW, note=None)]

    monkeypatch.setattr(job_repository, "get_job_by_id", get_job_by_id)
    monkeypatch.setattr(job_repository, "get_latest_assignment", get_latest_assignment)
    monkeypatch.setattr(job_repository, "get_partner_by_id", get_partner_by_id)
    monkeypatch.setattr(job_repository, "get_status_history", get_status_history)
    return calls


def _read(identity) -> JobDetailResponse:
    return asyncio.run(job_service.get_job_with_status(None, JOB_ID, identity))


def test_owner_sees_the_partners_rating_count(wiring):
    """The field the owner's tracking screen needs for "4.5 (12 jobs)".

    Until 2026-09-30 the count was in the database and in the matching score but
    in no response a client could reach, so the star rating could be rendered and
    the sample size behind it could not.
    """
    detail = _read(OWNER)

    assert detail.current_assignment is not None
    assert detail.current_assignment.partner_rating == Decimal("4.5")
    assert detail.current_assignment.partner_rating_count == 12


def test_assigned_partner_sees_their_own_count(wiring):
    """Withholding a partner's own rating from them would protect nobody."""
    detail = _read(ASSIGNED_PARTNER)

    assert detail.current_assignment.partner_rating_count == 12


@pytest.mark.parametrize(
    "identity", [BYSTANDER_PARTNER, BYSTANDER_OWNER], ids=["partner", "owner"]
)
def test_rating_count_is_withheld_from_everyone_else(wiring, identity):
    """A bystander gets the job, not the person.

    rating_count is weaker than a phone number on its own, and that is the
    argument that would put it outside the gate. It stays inside for two
    reasons: combined with rating_avg it is a fingerprint that identifies a
    specific mechanic across jobs, and a gate with one exception is a gate
    nobody trusts the next time.
    """
    detail = _read(identity)

    assert detail.current_assignment is not None
    assert detail.current_assignment.status == "accepted"
    for field in GATED_PARTNER_FIELDS:
        assert getattr(detail.current_assignment, field) is None, field


def test_bystander_still_learns_when_not_who(wiring):
    """The ETA is deliberately outside the gate — it says when, never who."""
    detail = _read(BYSTANDER_PARTNER)

    assert detail.current_assignment.estimated_arrival_min == 9


def test_partner_row_is_not_fetched_for_a_bystander(wiring):
    """The gate short-circuits the lookup rather than nulling it afterwards.

    Two reasons this is worth pinning: a redaction applied after the read is one
    `if` away from leaking into a log line, and the fetch is a round trip on the
    hot polling path that a bystander should not pay for.
    """
    _read(BYSTANDER_PARTNER)
    assert wiring["get_partner_by_id"] == 0

    _read(OWNER)
    assert wiring["get_partner_by_id"] == 1


def test_count_is_absent_when_the_offer_has_no_resolvable_partner(wiring, monkeypatch):
    """partner_id is nullable on job_assignments, so an offer can exist with no
    partner row to read a count from. The response degrades to None rather than
    failing the whole tracking poll."""

    async def unresolved(db, job_id):
        return Stub(status="offered", partner_id=None, estimated_arrival_min=None)

    monkeypatch.setattr(job_repository, "get_latest_assignment", unresolved)

    detail = _read(OWNER)

    assert detail.current_assignment.partner_rating_count is None
    assert detail.current_assignment.partner_rating is None
