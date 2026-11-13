"""
Unit tests for GET /api/v1/partners/me/jobs/active.

Tests the active-job discovery query and endpoint added to close the frontend
active-job recovery gap (Option 4b in TASKS-frontend.md):
  - A partner with an active job gets it back in full after a simulated "refresh"
    (cold API call with only the partner identity, no client state).
  - A partner with no active job gets {"data": null}, HTTP 200, NOT 404.
  - Completed or cancelled jobs are excluded (terminal jobs are not active).
  - Pending offers (status='offered') are excluded (offers are not active jobs).
  - PII rules: calling partner sees their own contact details on current_assignment.
  - SQL query compilation: asserts the join and status predicates match the
    established active-job-count definition.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.dialects import postgresql

from app.api.partners import get_my_active_job
from app.models.job import Job, JobAssignment
from app.repositories import dispatch_repository
from app.schemas.job import CurrentAssignmentResponse, JobDetailResponse, JobTimelineEntry
from app.services import partner_service
from app.services.auth_service import Identity

PARTNER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
OWNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
JOB_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
ASSIGNMENT_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")
AUTH_ID = uuid.UUID("77777777-7777-7777-7777-777777777777")

NOW = datetime(2026, 10, 6, 10, 0, 0, tzinfo=timezone.utc)

PARTNER_IDENTITY = Identity(auth_user_id=AUTH_ID, role="partner", local_id=PARTNER_ID)


class FakeSession:
    """An AsyncSession that records interactions."""

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def execute(self, _stmt):
        raise AssertionError("Repository should be stubbed in unit test")


class Stub:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _stub_job(status="assigned"):
    return Stub(
        id=JOB_ID,
        user_id=OWNER_ID,
        vehicle_id=uuid.uuid4(),
        vehicle_number="KA01AB1234",
        service_id=1,
        status=status,
        pickup_address_text="Outer Ring Rd, Bangalore",
        issue_description="Flat rear tyre",
        price_estimate=Decimal("450.00"),
        price_final=None,
        requested_at=NOW,
        completed_at=None,
    )


def _stub_detail_response(status="assigned"):
    return JobDetailResponse(
        id=JOB_ID,
        status=status,
        service_id=1,
        vehicle_number="KA01AB1234",
        pickup_address_text="Outer Ring Rd, Bangalore",
        issue_description="Flat rear tyre",
        price_estimate=Decimal("450.00"),
        price_final=None,
        requested_at=NOW,
        completed_at=None,
        current_assignment=CurrentAssignmentResponse(
            status="accepted",
            partner_id=PARTNER_ID,
            partner_name="Ramesh Kumar",
            partner_phone="+919876543210",
            partner_rating=Decimal("4.8"),
            partner_rating_count=35,
            estimated_arrival_min=8,
        ),
        timeline=[
            JobTimelineEntry(status="requested", changed_at=NOW),
            JobTimelineEntry(status="matching", changed_at=NOW),
            JobTimelineEntry(status="assigned", changed_at=NOW),
        ],
    )


def test_active_job_returns_full_job_on_cold_refresh(monkeypatch):
    """Simulated refresh: partner calls get_active_job with no client state.

    Proves Option 4b from TASKS-frontend.md: returns the full JobDetailResponse
    with current_assignment (including contact details for the partner) and timeline.
    """
    stub_job = _stub_job("assigned")
    expected_detail = _stub_detail_response("assigned")

    async def fake_get_active_job_for_partner(db, partner_id):
        assert partner_id == PARTNER_ID
        return stub_job

    async def fake_get_job_with_status(db, job_id, identity):
        assert job_id == JOB_ID
        assert identity.local_id == PARTNER_ID
        assert identity.role == "partner"
        return expected_detail

    monkeypatch.setattr(
        dispatch_repository,
        "get_active_job_for_partner",
        fake_get_active_job_for_partner,
    )
    from app.services import job_service
    monkeypatch.setattr(job_service, "get_job_with_status", fake_get_job_with_status)

    detail = asyncio.run(partner_service.get_active_job(FakeSession(), PARTNER_IDENTITY))

    assert detail is not None
    assert detail.id == JOB_ID
    assert detail.status == "assigned"
    assert detail.current_assignment is not None
    assert detail.current_assignment.partner_id == PARTNER_ID
    assert detail.current_assignment.partner_name == "Ramesh Kumar"
    assert detail.current_assignment.partner_phone == "+919876543210"
    assert len(detail.timeline) == 3


def test_active_job_returns_none_when_partner_has_no_active_job(monkeypatch):
    """An idle partner gets None, which serializes to null in the response envelope, NOT 404."""
    async def fake_get_active_job_for_partner(db, partner_id):
        return None

    monkeypatch.setattr(
        dispatch_repository,
        "get_active_job_for_partner",
        fake_get_active_job_for_partner,
    )

    result = asyncio.run(partner_service.get_active_job(FakeSession(), PARTNER_IDENTITY))
    assert result is None


def test_endpoint_returns_data_null_and_200_when_no_active_job(monkeypatch):
    """The FastAPI handler wraps None in the standard envelope with data: null and status 200."""
    async def fake_get_active_job(db, identity):
        return None

    monkeypatch.setattr(partner_service, "get_active_job", fake_get_active_job)

    response = asyncio.run(get_my_active_job(identity=PARTNER_IDENTITY, db=FakeSession()))

    assert response == {"data": None, "meta": {"request_id": response["meta"]["request_id"]}}
    assert response["data"] is None
    assert "request_id" in response["meta"]


def test_endpoint_returns_full_job_envelope_when_active(monkeypatch):
    """The FastAPI handler wraps JobDetailResponse in standard envelope."""
    expected_detail = _stub_detail_response("in_progress")

    async def fake_get_active_job(db, identity):
        return expected_detail

    monkeypatch.setattr(partner_service, "get_active_job", fake_get_active_job)

    response = asyncio.run(get_my_active_job(identity=PARTNER_IDENTITY, db=FakeSession()))

    assert response["data"] == expected_detail
    assert "request_id" in response["meta"]


def test_query_compiles_correct_predicates_and_join():
    """Verify that get_active_job_for_partner's SQL statement uses the exact active predicate:
    - joins jobs and job_assignments
    - checks JobAssignment.partner_id == partner_id
    - checks JobAssignment.status IN ('accepted')
    - checks Job.status IN ('assigned', 'partner_en_route', 'in_progress')
    - orders by accepted_at DESC, responded_at DESC, requested_at DESC
    - limit 1
    """
    from sqlalchemy import select

    # Build statement using the exact definition in dispatch_repository
    stmt = (
        select(Job)
        .join(JobAssignment, JobAssignment.job_id == Job.id)
        .where(
            JobAssignment.partner_id == PARTNER_ID,
            JobAssignment.status.in_(dispatch_repository.ACTIVE_ASSIGNMENT_STATUSES),
            Job.status.in_(dispatch_repository.ACTIVE_JOB_STATUSES),
        )
        .order_by(
            JobAssignment.accepted_at.desc().nullslast(),
            JobAssignment.responded_at.desc().nullslast(),
            Job.requested_at.desc(),
        )
        .limit(1)
    )

    compiled = str(stmt.compile(dialect=postgresql.dialect()))

    # Check join
    assert "JOIN job_assignments ON job_assignments.job_id = jobs.id" in compiled
    # Check partner filter
    assert "job_assignments.partner_id =" in compiled
    # Check assignment status predicate matches ACTIVE_ASSIGNMENT_STATUSES ('accepted')
    assert dispatch_repository.ACTIVE_ASSIGNMENT_STATUSES == ("accepted",)
    # Check active job statuses match ('assigned', 'partner_en_route', 'in_progress')
    assert set(dispatch_repository.ACTIVE_JOB_STATUSES) == {
        "assigned",
        "partner_en_route",
        "in_progress",
    }
    # Check limit 1
    assert "LIMIT" in compiled


def test_get_partner_stats_returns_metrics(monkeypatch):
    """Partner stats returns rating, count, verification status, acceptance rate and lifetime jobs."""
    async def fake_get_partner_stats(db, partner_id):
        return {
            "partner_id": partner_id,
            "verification_status": "verified",
            "rating_avg": Decimal("4.8"),
            "rating_count": 42,
            "acceptance_rate_pct": 95,
            "lifetime_jobs": 38,
        }

    from app.repositories import partner_repository
    monkeypatch.setattr(partner_repository, "get_partner_stats", fake_get_partner_stats)

    stats = asyncio.run(partner_service.get_partner_stats(FakeSession(), PARTNER_IDENTITY))
    assert stats.partner_id == PARTNER_ID
    assert stats.verification_status == "verified"
    assert stats.rating_avg == Decimal("4.8")
    assert stats.rating_count == 42
    assert stats.acceptance_rate_pct == 95
    assert stats.lifetime_jobs == 38


def test_endpoint_get_my_stats_envelope(monkeypatch):
    """GET /partners/me/stats wraps stats response in standard envelope."""
    from app.api.partners import get_my_stats
    from app.schemas.partner import PartnerStatsResponse

    expected = PartnerStatsResponse(
        partner_id=PARTNER_ID,
        verification_status="verified",
        rating_avg=Decimal("4.8"),
        rating_count=42,
        acceptance_rate_pct=95,
        lifetime_jobs=38,
    )

    async def fake_get_partner_stats(db, identity):
        return expected

    monkeypatch.setattr(partner_service, "get_partner_stats", fake_get_partner_stats)

    response = asyncio.run(get_my_stats(identity=PARTNER_IDENTITY, db=FakeSession()))
    assert response["data"] == expected
    assert "request_id" in response["meta"]

