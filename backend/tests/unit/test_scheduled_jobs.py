"""Scheduled jobs (ADR-050): slot rules, release by the worker, reschedule, clocks."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.repositories import dispatch_repository
from app.services import dispatch_worker, schedule_service as sched
from app.services.job_safeguard_service import overdue_at
from app.utils.errors import BadRequestError, ConflictError, NotFoundError

# Friday 21 Nov 2026, 09:30 IST
NOW = datetime(2026, 11, 21, 4, 0, tzinfo=timezone.utc)


def test_slots_are_two_hours_on_the_grid_from_two_hours_ahead_to_seven_days():
    slots = sched.available_slots(NOW)
    first_local = slots[0][0].astimezone(sched.IST)
    assert first_local.hour == 12 and first_local.date().day == 21        # 10:00 is < 2 h away
    assert all(e - s == timedelta(hours=2) for s, e in slots)
    assert all(s.astimezone(sched.IST).hour in sched.SLOT_STARTS for s, _ in slots)
    assert all(NOW + sched.MIN_LEAD <= s <= NOW + sched.MAX_AHEAD for s, _ in slots)
    # rest of today (12, 14, 16, 18), six a day for six days, and 08:00 on day seven
    # (the 7-day limit is 09:30 IST on 28 Nov)
    assert len(slots) == 4 + 6 * 6 + 1


def test_a_listed_slot_validates_in_any_timezone_and_others_are_400():
    start, end = sched.available_slots(NOW)[0]
    assert sched.validate_slot(start.astimezone(sched.IST), NOW) == (start, end)
    for bad in (start + timedelta(minutes=30), NOW + timedelta(hours=1), NOW + timedelta(days=9),
                start.replace(tzinfo=None)):
        with pytest.raises(BadRequestError) as e:
            sched.validate_slot(bad, NOW)
        assert e.value.code == "SLOT_NOT_AVAILABLE"


def test_label_is_india_time():
    start = datetime(2026, 11, 23, 4, 30, tzinfo=timezone.utc)   # 10:00 IST
    assert sched.slot_label(start, start + timedelta(hours=2)) == "Mon 23 Nov, 10:00-12:00"


def test_release_lead():
    slot = NOW + timedelta(minutes=50)
    assert not sched.due_for_release(slot, NOW)
    assert sched.due_for_release(slot, NOW + timedelta(minutes=5))


def test_a_partner_who_accepts_a_booking_early_is_due_from_the_slot():
    accepted = SimpleNamespace(accepted_at=NOW, estimated_arrival_min=10)
    plain = overdue_at(accepted)
    booked = overdue_at(accepted, SimpleNamespace(scheduled_for=NOW + timedelta(minutes=45)))
    assert booked - plain == timedelta(minutes=45)


# --- release -------------------------------------------------------------------

def _job(status="scheduled", start=NOW + timedelta(minutes=40)):
    return SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), status=status,
                           scheduled_for=start, slot_end=start + timedelta(hours=2), requested_at=NOW - timedelta(days=3))


class _Db:
    def __init__(self):
        self.commit, self.rollback, self.refresh = AsyncMock(), AsyncMock(), AsyncMock()


def _patches(job):
    updates = []

    async def update(db, j, **fields):
        updates.append(fields)
        for k, v in fields.items():
            setattr(j, k, v)
    return updates, [
        patch.object(sched.job_repository, "get_job_by_id_for_update", AsyncMock(return_value=job)),
        patch.object(sched.job_repository, "update_job_fields", update),
        patch.object(sched.job_repository, "create_status_history_row", AsyncMock()),
        patch.object(sched.notification_service, "notify_event", AsyncMock()),
    ]


@pytest.mark.asyncio
async def test_release_moves_to_requested_resets_the_clock_and_dispatches():
    job = _job()
    updates, ps = _patches(job)
    from app.services import job_service
    with ps[0], ps[1], ps[2] as hist, ps[3] as notify, patch.object(job_service, "_try_dispatch", AsyncMock()) as disp:
        out = await sched.release_scheduled_job(_Db(), job.id, now=NOW)
    assert out == "released" and updates == [{"status": "requested", "requested_at": NOW}]
    assert "finding a partner" in hist.await_args.kwargs["note"]
    assert notify.await_args.kwargs["event"] == "scheduled_job_starting"
    disp.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_slot_that_already_ended_is_cancelled_not_dispatched():
    job = _job(start=NOW - timedelta(hours=3))
    updates, ps = _patches(job)
    from app.services import job_service
    with ps[0], ps[1], ps[2], ps[3] as notify, patch.object(job_service, "_try_dispatch", AsyncMock()) as disp:
        out = await sched.release_scheduled_job(_Db(), job.id, now=NOW)
    assert out == "missed" and updates[0]["status"] == "cancelled"
    assert notify.await_args.kwargs["event"] == "job_expired"
    disp.assert_not_awaited()


@pytest.mark.asyncio
async def test_release_does_nothing_too_early_or_after_a_cancel():
    for job in (_job(start=NOW + timedelta(hours=3)), _job(status="cancelled")):
        updates, ps = _patches(job)
        with ps[0], ps[1], ps[2], ps[3]:
            assert await sched.release_scheduled_job(_Db(), job.id, now=NOW) is None
        assert updates == []


# --- reschedule ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_reschedule_only_your_own_booking_and_only_while_scheduled():
    target = sched.available_slots(NOW)[3][0]
    job = _job()
    _, ps = _patches(job)
    with ps[0], ps[1], ps[2], ps[3]:
        with pytest.raises(NotFoundError):
            await sched.reschedule(_Db(), job.id, uuid.uuid4(), target, now=NOW)
        moved = await sched.reschedule(_Db(), job.id, job.user_id, target, now=NOW)
    assert moved.scheduled_for == target and moved.slot_end == target + timedelta(hours=2)
    started = _job(status="matching")
    _, ps = _patches(started)
    with ps[0], ps[1], ps[2], ps[3]:
        with pytest.raises(ConflictError) as e:
            await sched.reschedule(_Db(), started.id, started.user_id, target, now=NOW)
    assert e.value.code == "JOB_NOT_SCHEDULED"


# --- worker ----------------------------------------------------------------------

class _Ctx:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *a):
        return False


def test_the_sweep_releases_due_bookings(monkeypatch):
    due = uuid.uuid4()
    seen = {}

    async def empty(_db, **_k):
        return []

    async def due_ids(_db, *, starts_before, limit=200):
        seen["before"] = starts_before
        return [due]

    async def release(_db, jid, now=None):
        seen["released"] = jid
        return "released"

    for name in ("get_expired_offer_ids", "get_searchable_job_ids", "get_orphaned_requested_job_ids"):
        monkeypatch.setattr(dispatch_repository, name, empty)
    monkeypatch.setattr(dispatch_repository, "get_due_scheduled_job_ids", due_ids)
    monkeypatch.setattr(sched, "release_scheduled_job", release)
    res = asyncio.run(dispatch_worker.sweep_once(lambda: _Ctx(), now=NOW))
    assert seen == {"before": NOW + sched.RELEASE_LEAD, "released": due}
    assert res.scheduled_released == 1
