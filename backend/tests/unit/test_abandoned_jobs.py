"""ADR-036: jobs nobody will move again are closed or dropped from the live view.

Two cases, handled differently on purpose:

  * A job still in 'requested' minutes after it was raised was never dispatched
    (the process died between creating it and dispatching it). Nothing will ever
    move it, and the owner's app shows "searching" forever. The worker cancels
    it under the job lock and tells the owner.
  * A 'no_match_found' job whose search window closed already reads as ended in
    both clients. Its status is an outcome the analytics count (ADR-021), so it
    is not rewritten; it just stops counting as live on the admin board and in
    the stuck-jobs alert an hour after it was raised.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from app.models.job import Job
from app.repositories import dispatch_repository, job_repository
from app.services import admin_ops_service, dispatch_service, dispatch_worker, notification_service
from app.utils.scoring import NO_MATCH_LIVE_FOR_S, ORPHAN_REQUESTED_S
from tests.unit.test_dispatch_locking import FakeSession

NOW = datetime(2026, 11, 20, 12, 0, 0, tzinfo=timezone.utc)


class _Session(FakeSession):
    def __init__(self, events):
        super().__init__()
        self.events = events

    async def commit(self):
        self.events.append("commit")
        await super().commit()

    async def rollback(self):
        self.events.append("rollback")
        await super().rollback()


def _wire(monkeypatch, *, status="requested", age_s=ORPHAN_REQUESTED_S + 5):
    events: list = []
    job = Job(id=uuid.uuid4(), user_id=uuid.uuid4(), status=status, service_id=1,
              requested_at=NOW - timedelta(seconds=age_s))

    async def lock(_db, _id):
        events.append("lock")
        return job

    async def update(_db, j, **fields):
        events.append(("update", fields.get("status")))
        for k, v in fields.items():
            setattr(j, k, v)
        return j

    async def history(_db, *, job_id, status, note=None):
        events.append(("history", status, note))

    async def notify(_db, *, job, status, actor_role, partner_ids=()):
        events.append(("notify", status, actor_role))
        return 1

    monkeypatch.setattr(job_repository, "get_job_by_id_for_update", lock)
    monkeypatch.setattr(job_repository, "update_job_fields", update)
    monkeypatch.setattr(job_repository, "create_status_history_row", history)
    monkeypatch.setattr(notification_service, "notify_job_status_change", notify)
    return events, job


def test_an_orphaned_request_is_cancelled_under_the_lock_and_the_owner_told(monkeypatch):
    events, job = _wire(monkeypatch)

    done = asyncio.run(dispatch_service.expire_orphaned_request(_Session(events), job.id, now=NOW))

    assert done is True
    assert events[0] == "lock", "the job is locked before anything is judged"
    assert ("update", "cancelled") in events
    assert any(e[0] == "history" and e[1] == "cancelled" for e in events if isinstance(e, tuple))
    assert ("notify", "cancelled", "system") in events
    assert events[-1] == "commit"
    assert job.cancellation_reason.startswith("Expired")


def test_a_request_dispatched_before_the_lock_is_left_alone(monkeypatch):
    events, job = _wire(monkeypatch, status="matching")
    done = asyncio.run(dispatch_service.expire_orphaned_request(_Session(events), job.id, now=NOW))
    assert done is False
    assert events == ["lock", "rollback"]


def test_a_young_request_is_left_alone(monkeypatch):
    events, job = _wire(monkeypatch, age_s=ORPHAN_REQUESTED_S - 30)
    done = asyncio.run(dispatch_service.expire_orphaned_request(_Session(events), job.id, now=NOW))
    assert done is False
    assert events == ["lock", "rollback"]


def test_a_system_cancel_tells_only_the_owner_with_its_own_event():
    assert notification_service.event_for("cancelled", actor_role="system") == "job_expired"
    assert notification_service.recipients_for("cancelled", actor_role="system") == ("user",)
    assert "job_expired" in notification_service.NOTIFICATION_EVENTS
    from app.services.push_service import PUSH_TITLES
    assert "job_expired" in PUSH_TITLES


# --- sweep_once runs the third list --------------------------------------------

class _Ctx:
    async def __aenter__(self):
        return FakeSession()

    async def __aexit__(self, *_exc):
        return False


def test_a_sweep_expires_orphaned_requests(monkeypatch):
    orphan = uuid.uuid4()
    seen = {}

    async def empty(_db, **_k):
        return []

    async def orphans(_db, *, requested_before, limit=50):
        seen["requested_before"] = requested_before
        return [orphan]

    async def expire(_db, jid, now=None):
        seen["expired"] = jid
        return True

    monkeypatch.setattr(dispatch_repository, "get_expired_offer_ids", empty)
    monkeypatch.setattr(dispatch_repository, "get_searchable_job_ids", empty)
    monkeypatch.setattr(dispatch_repository, "get_due_scheduled_job_ids", _no_due)
    monkeypatch.setattr(dispatch_repository, "get_orphaned_requested_job_ids", orphans)
    monkeypatch.setattr(dispatch_service, "expire_orphaned_request", expire)

    res = asyncio.run(dispatch_worker.sweep_once(lambda: _Ctx(), now=NOW))

    assert seen == {"requested_before": NOW - timedelta(seconds=ORPHAN_REQUESTED_S), "expired": orphan}
    assert res.requests_expired == 1


# --- no_match_found stops being live --------------------------------------------

def test_an_old_no_match_job_is_not_a_stuck_job():
    recent, old = uuid.uuid4(), uuid.uuid4()
    r = admin_ops_service.evaluate_alerts(
        now=NOW,
        live_jobs=[
            (recent, "no_match_found", NOW - timedelta(minutes=20), NOW - timedelta(minutes=19)),
            (old, "no_match_found", NOW - timedelta(seconds=NO_MATCH_LIVE_FOR_S + 60),
             NOW - timedelta(seconds=NO_MATCH_LIVE_FOR_S)),
        ],
        window_counts={}, partners_on_duty=5, partners_verified=9,
    )
    (alert,) = r.alerts
    assert alert.job_ids == [recent]
    assert r.live_jobs == 1, "an ended search is not a live job"


async def _no_due(_db, **_k):
    return []
