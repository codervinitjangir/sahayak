"""Partner data export (ADR-045 amendment) and staff alert webhook (ADR-047)."""
import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
import pytest

from app.models.partner import Partner
from app.repositories import partner_repository
from app.schemas.admin_ops import AdminAlert
from app.services import partner_service, staff_alert_service
from app.services.auth_service import Identity

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)


# --- export --------------------------------------------------------------------

def _rows(job_id, status="completed"):
    assignment = SimpleNamespace(
        job_id=job_id, status=status, offered_at=NOW, responded_at=NOW, accepted_at=NOW,
        rejection_reason=None, distance_at_offer_m=Decimal("1200.5"), estimated_arrival_min=9)
    return {
        "services": [("battery_jumpstart", "Battery jump-start")],
        "equipment": [SimpleNamespace(equipment_type="flatbed", registration_number="KA01AB1234",
                                      verification_status="verified", verified_at=NOW)],
        "documents": [SimpleNamespace(doc_type="photo_id", status="approved", reference_number="XXXX1234",
                                      expiry_date=date(2030, 1, 1), uploaded_at=NOW, rejection_reason=None,
                                      file_url="partners/secret/path.png")],
        "assignments": [(assignment, "completed", Decimal("650.00"), NOW, NOW, None, "battery_jumpstart")],
        "payments": [SimpleNamespace(job_id=job_id, amount=Decimal("650.00"), status="completed",
                                     payment_method="cash", created_at=NOW)],
        "ratings": [SimpleNamespace(job_id=job_id, rated_by="user", rating=5, comment="quick"),
                    SimpleNamespace(job_id=job_id, rated_by="partner", rating=4, comment=None)],
        "revisions": [SimpleNamespace(job_id=job_id, proposed_amount=Decimal("650"), reason="terminal",
                                      status="approved", created_at=NOW, decided_at=NOW)],
        "photos": [],
        "notifications": [SimpleNamespace(event="document_expiring", message="m", is_read=False, sent_at=NOW)],
    }


@pytest.mark.asyncio
async def test_partner_export_has_their_data_and_nothing_internal():
    p = Partner(id=uuid.uuid4(), name="Ravi", phone="+919000000123", verification_status="verified",
                rating_avg=Decimal("4.5"), rating_count=2, is_available=False, created_at=NOW)
    job_id = uuid.uuid4()
    with patch.object(partner_repository, "get_partner_by_id", AsyncMock(return_value=p)), \
         patch.object(partner_repository, "export_partner_rows", AsyncMock(return_value=_rows(job_id))):
        out = await partner_service.export_me(AsyncMock(), Identity(auth_user_id=uuid.uuid4(), role="partner", local_id=p.id))
    assert out["profile"]["phone"] == "+919000000123" and out["profile"]["rating_avg"] == 4.5
    assert out["services"] == [{"code": "battery_jumpstart", "name": "Battery jump-start"}]
    assert out["documents"][0]["reference_number"] == "XXXX1234"
    job = out["jobs"][0]
    assert job["service"] == "battery_jumpstart" and job["price_final"] == 650.0
    assert job["payments"][0]["method"] == "cash"
    # ADR-053: the owner's rating of the partner is never exported per job, only the average.
    assert {r["by"] for r in job["ratings"]} == {"you"}
    assert out["price_requests"][0]["status"] == "approved"
    text = json.dumps(out)
    assert "partners/secret/path.png" not in text      # storage paths stay internal
    assert "score_components" not in text and "matching_score" not in text


@pytest.mark.asyncio
async def test_an_offer_the_partner_never_took_shows_no_payments_or_ratings():
    p = Partner(id=uuid.uuid4(), name="Ravi", phone="+919000000123", verification_status="verified",
                rating_avg=Decimal("0"), rating_count=0, is_available=True, created_at=NOW)
    job_id = uuid.uuid4()
    with patch.object(partner_repository, "get_partner_by_id", AsyncMock(return_value=p)), \
         patch.object(partner_repository, "export_partner_rows", AsyncMock(return_value=_rows(job_id, "rejected"))):
        out = await partner_service.export_me(AsyncMock(), Identity(auth_user_id=uuid.uuid4(), role="partner", local_id=p.id))
    assert out["jobs"][0]["your_assignment"] == "rejected"
    assert out["jobs"][0]["payments"] == [] and out["jobs"][0]["ratings"] == []


# --- staff alerts ----------------------------------------------------------------

def _alert(code, severity="critical", message="m"):
    return AdminAlert(code=code, severity=severity, message=message, count=1)


@pytest.fixture
def redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("app.services.staff_alert_service.get_redis", return_value=r):
        yield r


@pytest.mark.asyncio
async def test_a_critical_alert_is_sent_once_and_warnings_never(redis):
    post = AsyncMock(return_value=True)
    with patch.object(staff_alert_service, "_post", post):
        first = await staff_alert_service.notify_once(
            [_alert("STUCK_JOBS", message="2 job(s) have not moved"), _alert("LOW_PARTNERS_ON_DUTY", "warning")],
            "https://hooks.example/x", 3600)
        second = await staff_alert_service.notify_once([_alert("STUCK_JOBS")], "https://hooks.example/x", 3600)
    assert first["sent"] == ["STUCK_JOBS"] and second["sent"] == []
    assert post.await_count == 1
    assert "2 job(s) have not moved" in post.await_args.args[1]


@pytest.mark.asyncio
async def test_cleared_is_sent_when_the_alert_goes_away(redis):
    post = AsyncMock(return_value=True)
    with patch.object(staff_alert_service, "_post", post):
        await staff_alert_service.notify_once([_alert("NO_PARTNERS_ON_DUTY")], "u", 3600)
        out = await staff_alert_service.notify_once([], "u", 3600)
        again = await staff_alert_service.notify_once([], "u", 3600)
    assert out["cleared"] == ["NO_PARTNERS_ON_DUTY"] and again["cleared"] == []
    assert "cleared" in post.await_args.args[1]


@pytest.mark.asyncio
async def test_a_failed_send_is_retried_next_tick(redis):
    with patch.object(staff_alert_service, "_post", AsyncMock(return_value=False)):
        out = await staff_alert_service.notify_once([_alert("STUCK_JOBS")], "u", 3600)
    assert out["sent"] == []
    with patch.object(staff_alert_service, "_post", AsyncMock(return_value=True)):
        out = await staff_alert_service.notify_once([_alert("STUCK_JOBS")], "u", 3600)
    assert out["sent"] == ["STUCK_JOBS"]


@pytest.mark.asyncio
async def test_messages_carry_no_ids_or_numbers_of_people():
    alert = AdminAlert(code="STUCK_JOBS", severity="critical", message="1 job(s) have not moved.",
                       count=1, job_ids=[uuid.uuid4()], partner_ids=[uuid.uuid4()])
    text = staff_alert_service._text(alert)
    assert str(alert.job_ids[0]) not in text and str(alert.partner_ids[0]) not in text


@pytest.mark.asyncio
async def test_off_without_a_webhook_and_at_most_once_a_minute():
    staff_alert_service._last_check = None
    get_alerts = AsyncMock(return_value=SimpleNamespace(alerts=[]))
    factory = lambda: _Session()  # noqa: E731
    with patch("app.services.staff_alert_service.get_settings",
               return_value=SimpleNamespace(STAFF_ALERT_WEBHOOK_URL="", STAFF_ALERT_REPEAT_MIN=60)), \
         patch.object(staff_alert_service.admin_ops_service, "get_alerts", get_alerts):
        assert await staff_alert_service.check(factory, now=NOW) is None
    get_alerts.assert_not_awaited()
    with patch("app.services.staff_alert_service.get_settings",
               return_value=SimpleNamespace(STAFF_ALERT_WEBHOOK_URL="https://h", STAFF_ALERT_REPEAT_MIN=60)), \
         patch.object(staff_alert_service.admin_ops_service, "get_alerts", get_alerts), \
         patch.object(staff_alert_service, "notify_once", AsyncMock(return_value={"sent": [], "cleared": []})):
        assert await staff_alert_service.check(factory, now=NOW) == {"sent": [], "cleared": []}
        assert await staff_alert_service.check(factory, now=NOW) is None   # 0 s later: skipped
    assert get_alerts.await_count == 1
    staff_alert_service._last_check = None


class _Session:
    async def __aenter__(self):
        return AsyncMock()

    async def __aexit__(self, *a):
        return False
