"""ADR-024: staff cancel, owner suspension, audit log."""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.job import Job, JobAssignment
from app.models.user import User
from app.services import admin_ops_service, auth_service, notification_service
from app.services.auth_service import Identity
from app.utils.errors import AppError, ConflictError, ForbiddenError

ADMIN = Identity(role="admin", local_id=uuid.uuid4(), auth_user_id="auth-admin")


def test_support_cancel_tells_both_sides():
    assert notification_service.event_for("cancelled", actor_role="admin") == "job_cancelled_by_support"
    assert set(notification_service.recipients_for("cancelled", actor_role="admin")) == {"user", "partner"}
    # Unchanged for the existing actors.
    assert notification_service.recipients_for("cancelled", actor_role="user") == ("partner",)
    assert notification_service.recipients_for("cancelled", actor_role="partner") == ("user",)


@pytest.mark.asyncio
async def test_suspended_owner_is_refused_at_identity_resolution():
    user = User(id=uuid.uuid4(), name="X", phone="+910000000000", suspended_at=datetime.now(timezone.utc))
    claims = MagicMock(auth_user_id=uuid.uuid4())
    with patch("app.repositories.auth_repository.get_user_by_auth_id", AsyncMock(return_value=user)), \
         patch("app.repositories.auth_repository.get_partner_by_auth_id", AsyncMock(return_value=None)), \
         patch("app.repositories.auth_repository.get_admin_by_auth_id", AsyncMock(return_value=None)):
        with pytest.raises(ForbiddenError) as exc:
            await auth_service.resolve_identity(AsyncMock(), claims)
    assert exc.value.code == "ACCOUNT_SUSPENDED"


@pytest.mark.asyncio
async def test_active_owner_still_resolves():
    user = User(id=uuid.uuid4(), name="X", phone="+910000000000")
    claims = MagicMock(auth_user_id=uuid.uuid4())
    with patch("app.repositories.auth_repository.get_user_by_auth_id", AsyncMock(return_value=user)), \
         patch("app.repositories.auth_repository.get_partner_by_auth_id", AsyncMock(return_value=None)), \
         patch("app.repositories.auth_repository.get_admin_by_auth_id", AsyncMock(return_value=None)):
        ident = await auth_service.resolve_identity(AsyncMock(), claims)
    assert ident.role == "user" and ident.local_id == user.id


@pytest.mark.asyncio
async def test_staff_cancel_closes_offers_notifies_and_audits_in_one_commit():
    db = AsyncMock()
    job = Job(id=uuid.uuid4(), user_id=uuid.uuid4(), status="assigned", requested_at=datetime.now(timezone.utc))
    a = JobAssignment(id=uuid.uuid4(), job_id=job.id, partner_id=uuid.uuid4(), status="accepted")
    calls = []

    def recorder(label):
        async def _f(*args, **kwargs):
            calls.append(label(*args, **kwargs) if callable(label) else label)
        return _f

    async def commit():
        calls.append("commit")

    db.commit.side_effect = commit
    with patch("app.repositories.job_repository.get_job_by_id_for_update", AsyncMock(return_value=job)),          patch("app.repositories.job_repository.get_open_assignments", AsyncMock(return_value=[a])),          patch("app.repositories.job_repository.update_job_fields", recorder("job")),          patch("app.repositories.job_repository.set_assignment_status", recorder(lambda db_, asg, st: f"asg:{st}")),          patch("app.repositories.job_repository.create_status_history_row", recorder("history")),          patch("app.services.notification_service.notify_job_status_change", recorder(lambda *a_, **k: f"notify:{k['actor_role']}")),          patch("app.repositories.admin_ops_repository.add_audit", recorder(lambda *a_, **k: f"audit:{k['action']}")):
        await admin_ops_service.cancel_job(db, job.id, "duplicate request", ADMIN)

    assert calls == ["job", "asg:cancelled", "history", "notify:admin", "audit:job_cancelled", "commit"]


@pytest.mark.asyncio
async def test_staff_cannot_cancel_a_finished_job():
    job = Job(id=uuid.uuid4(), user_id=uuid.uuid4(), status="completed")
    with patch("app.repositories.job_repository.get_job_by_id_for_update", AsyncMock(return_value=job)):
        with pytest.raises(ConflictError):
            await admin_ops_service.cancel_job(AsyncMock(), job.id, "too late", ADMIN)


@pytest.mark.asyncio
async def test_repeating_a_suspension_writes_no_audit_row():
    user = User(id=uuid.uuid4(), name="X", phone="+910000000000", created_at=datetime.now(timezone.utc),
                suspended_at=datetime.now(timezone.utc))
    audit = AsyncMock()
    with patch("app.repositories.admin_ops_repository.get_user_for_update", AsyncMock(return_value=user)), \
         patch("app.repositories.admin_ops_repository.get_user", AsyncMock(return_value=user)), \
         patch("app.repositories.admin_ops_repository.count_jobs_for_user", AsyncMock(return_value=2)), \
         patch("app.repositories.admin_ops_repository.add_audit", audit):
        res = await admin_ops_service.set_user_suspension(
            AsyncMock(), user.id, suspended=True, reason="again", identity=ADMIN)
    audit.assert_not_awaited()
    assert res.suspended_at is not None and res.job_count == 2


@pytest.mark.asyncio
async def test_unknown_board_filter_is_400():
    with pytest.raises(AppError) as exc:
        await admin_ops_service.list_jobs(AsyncMock(), status="bogus", q=None, limit=10, offset=0)
    assert exc.value.status_code == 400


# --- Operational alerts (GET /admin/alerts) ---------------------------------
from datetime import timedelta  # noqa: E402

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


def _alerts(**kw):
    base = dict(now=NOW, live_jobs=[], window_counts={}, partners_on_duty=5, partners_verified=9)
    base.update(kw)
    return admin_ops_service.evaluate_alerts(**base)


def test_quiet_system_raises_nothing_but_still_reports_its_figures():
    r = _alerts()
    assert r.alerts == [] and r.partners_on_duty == 5 and r.no_match_rate is None


def test_a_job_is_stuck_only_past_its_own_status_limit():
    fresh, stuck = uuid.uuid4(), uuid.uuid4()
    r = _alerts(live_jobs=[
        (fresh, "matching", NOW - timedelta(minutes=30), NOW - timedelta(minutes=11)),
        (stuck, "matching", NOW - timedelta(minutes=30), NOW - timedelta(minutes=13)),
        # 13 minutes en route is ordinary; the limit there is 90.
        (uuid.uuid4(), "partner_en_route", NOW - timedelta(minutes=40), NOW - timedelta(minutes=13)),
    ])
    (alert,) = r.alerts
    assert alert.code == "STUCK_JOBS" and alert.severity == "critical"
    assert alert.job_ids == [stuck] and alert.count == 1


def test_a_job_without_history_is_aged_from_its_request_time():
    job = uuid.uuid4()
    r = _alerts(live_jobs=[(job, "requested", NOW - timedelta(minutes=6), None)])
    assert r.alerts[0].job_ids == [job]


def test_no_match_rate_needs_enough_jobs_to_mean_anything():
    few = _alerts(window_counts={"no_match_found": 3, "completed": 1})
    assert few.no_match_rate is None and few.alerts == []
    many = _alerts(window_counts={"no_match_found": 3, "completed": 7})
    assert many.no_match_rate == 0.3
    assert [a.code for a in many.alerts] == ["HIGH_NO_MATCH_RATE"]


def test_partner_cover_alerts():
    assert [a.code for a in _alerts(partners_on_duty=0).alerts] == ["NO_PARTNERS_ON_DUTY"]
    assert [a.code for a in _alerts(partners_on_duty=2).alerts] == ["LOW_PARTNERS_ON_DUTY"]
