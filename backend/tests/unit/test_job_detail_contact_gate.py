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
from geoalchemy2 import WKTElement

from app.repositories import job_repository, service_repository, user_repository
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

# Everything that identifies the *owner* or locates their vehicle. Same gate,
# same reason: an offered-but-not-accepted partner has no need to know who the
# owner is or precisely where the car is parked.
GATED_OWNER_FIELDS = ("owner_name", "owner_phone", "pickup_lat", "pickup_lng")


class Stub:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _job():
    return Stub(
        id=JOB_ID,
        user_id=OWNER_ID,
        vehicle_id=uuid.UUID("44444444-4444-4444-4444-444444444444"),
        status="in_progress",
        service_id=1,
        vehicle_number="MH12AB1234",
        pickup_location=WKTElement("POINT(73.8567 18.5204)", srid=4326),
        pickup_address_text="Baner Road",
        issue_description="Flat tyre",
        price_estimate=Decimal("500.00"),
        price_final=None,
        requested_at=NOW,
        completed_at=None,
        start_code="4821",
    )


def _partner():
    return Stub(
        id=PARTNER_ID,
        name="Ravi Kumar",
        phone="+919812345678",
        rating_avg=Decimal("4.5"),
        rating_count=12,
    )


def _owner():
    return Stub(name="Asha Rao", phone="+919876543210")


@pytest.fixture
def wiring(monkeypatch):
    """Stub every repository read get_job_with_status makes."""
    calls = {"get_partner_by_id": 0, "get_user_by_id": 0}

    async def get_job_by_id(db, job_id):
        return _job()

    async def get_latest_assignment(db, job_id):
        return Stub(status="accepted", partner_id=PARTNER_ID, estimated_arrival_min=9)

    async def get_partner_by_id(db, partner_id):
        calls["get_partner_by_id"] += 1
        return _partner()

    async def get_user_by_id(db, user_id):
        calls["get_user_by_id"] += 1
        return _owner()

    async def get_service_by_id(db, service_id):
        return Stub(id=service_id, code="flat_tyre", name="Flat-Tyre Support")

    async def get_status_history(db, job_id):
        return [Stub(status="requested", changed_at=NOW, note=None)]

    monkeypatch.setattr(job_repository, "get_job_by_id", get_job_by_id)
    monkeypatch.setattr(job_repository, "get_latest_assignment", get_latest_assignment)
    monkeypatch.setattr(job_repository, "get_partner_by_id", get_partner_by_id)
    monkeypatch.setattr(job_repository, "get_status_history", get_status_history)
    monkeypatch.setattr(service_repository, "get_service_by_id", get_service_by_id)
    monkeypatch.setattr(user_repository, "get_user_by_id", get_user_by_id)
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


def test_owner_sees_the_start_code_and_pickup_coordinates(wiring):
    """The owner is the only caller who is given the code.

    It is what they read aloud to the mechanic, so the owner must have it —
    and the mechanic must not, because submitting it is the proof they are on
    scene. The coordinates are the other half of "where is the car": the
    assigned partner needs both, the owner already knows them.
    """
    detail = _read(OWNER)

    assert detail.start_code == "4821"
    assert detail.owner_name == "Asha Rao"
    assert detail.owner_phone == "+919876543210"
    assert detail.pickup_lat == pytest.approx(18.5204)
    assert detail.pickup_lng == pytest.approx(73.8567)


def test_assigned_partner_gets_owner_contact_but_never_the_start_code(wiring):
    """The partner needs to phone the owner and drive to the pin.

    They must not be able to read the code back: GET /jobs/{id} is polled every
    few seconds, so a code visible here would not be a proof of presence at all.
    """
    detail = _read(ASSIGNED_PARTNER)

    assert detail.owner_name == "Asha Rao"
    assert detail.owner_phone == "+919876543210"
    assert detail.pickup_lat == pytest.approx(18.5204)
    assert detail.start_code is None


@pytest.mark.parametrize(
    "identity", [BYSTANDER_PARTNER, BYSTANDER_OWNER], ids=["partner", "owner"]
)
def test_owner_identity_and_location_are_withheld_from_bystanders(wiring, identity):
    """A bystander gets the job, not the person or the parking spot."""
    detail = _read(identity)

    for field in GATED_OWNER_FIELDS:
        assert getattr(detail, field) is None, field
    assert detail.start_code is None


def test_bystander_does_not_cost_a_owner_lookup(wiring):
    """The gate short-circuits the owner read too, not just the partner read."""
    _read(BYSTANDER_PARTNER)
    assert wiring["get_user_by_id"] == 0

    _read(ASSIGNED_PARTNER)
    assert wiring["get_user_by_id"] == 1


def test_detail_carries_the_service_code_and_name(wiring):
    """Clients speak codes; jobs store a numeric service_id.

    Returning both here is what lets the owner screen label a job without
    shipping its own id-to-code table, which is exactly the drift that made
    GET /services necessary.
    """
    detail = _read(OWNER)

    assert detail.service_id == 1
    assert detail.service_code == "flat_tyre"
    assert detail.service_name == "Flat-Tyre Support"


def test_owner_gets_no_partner_details_while_the_offer_is_pending(wiring, monkeypatch):
    """Found 2026-11-14 in a live run: the owner's page rendered tel:<partner
    phone> while the assignment was still 'offered'. Release follows the
    assignment (ADR-017), so until the partner accepts the owner learns the
    status and the ETA, never who."""

    async def offered(db, job_id):
        return Stub(status="offered", partner_id=PARTNER_ID, estimated_arrival_min=None)

    monkeypatch.setattr(job_repository, "get_latest_assignment", offered)

    detail = _read(OWNER)

    assert detail.current_assignment.status == "offered"
    for field in GATED_PARTNER_FIELDS:
        assert getattr(detail.current_assignment, field) is None, field
    assert wiring["get_partner_by_id"] == 0
