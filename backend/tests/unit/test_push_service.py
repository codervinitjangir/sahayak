"""ADR-026: push staging and message building."""
import uuid
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.devices import PushTokenRequest
from app.services import push_service


def test_messages_fan_out_to_every_device_of_the_recipient_only():
    owner, other = uuid.uuid4(), uuid.uuid4()
    items = [{"recipient_type": "user", "recipient_id": owner, "message": "Your partner is on the way to you.",
              "event": "job_partner_en_route", "job_id": "j1"}]
    tokens = {("user", owner): ["ExponentPushToken[aaaaaaaaaaaa]", "ExponentPushToken[bbbbbbbbbbbb]"],
              ("user", other): ["ExponentPushToken[cccccccccccc]"]}
    msgs = push_service.build_messages(items, tokens)
    assert [m["to"] for m in msgs] == ["ExponentPushToken[aaaaaaaaaaaa]", "ExponentPushToken[bbbbbbbbbbbb]"]
    assert msgs[0]["body"] == "Your partner is on the way to you."
    assert msgs[0]["data"] == {"event": "job_partner_en_route", "job_id": "j1"}


def test_staging_on_a_test_double_is_a_no_op():
    push_service.stage(AsyncMock(), recipient_type="user", recipient_id=uuid.uuid4(),
                       message="x", event_name="e", job_id=None)


def test_rollback_drops_staged_pushes():
    s = Session()
    push_service.stage(s, recipient_type="user", recipient_id=uuid.uuid4(), message="x", event_name="e", job_id=None)
    assert s.info.get(push_service._INFO_KEY)
    push_service._after_rollback(s)
    assert push_service._INFO_KEY not in s.info


@pytest.mark.parametrize("token", ["ExponentPushToken[abcDEF123456]", "ExpoPushToken[abc-DEF_123456]"])
def test_accepts_expo_tokens(token):
    assert PushTokenRequest(token=token).token == token


@pytest.mark.parametrize("token", ["", "fcm:abc", "ExponentPushToken[]", "ExponentPushToken[a b]"])
def test_rejects_anything_else(token):
    with pytest.raises(ValidationError):
        PushTokenRequest(token=token)


@pytest.mark.asyncio
async def test_drain_waits_for_in_flight_deliveries():
    # N1 (2026-11-14): a delivery borrows a pooled connection after commit; shutdown
    # and the pool-measuring harness must be able to wait for it.
    import asyncio

    done = []

    async def slow():
        await asyncio.sleep(0.05)
        done.append(1)

    task = asyncio.get_running_loop().create_task(slow())
    push_service._tasks.add(task)
    task.add_done_callback(push_service._tasks.discard)

    assert await push_service.drain() == 1
    assert done == [1]
    assert await push_service.drain() == 0


@pytest.mark.asyncio
async def test_deliveries_run_one_at_a_time(monkeypatch):
    """Each delivery borrows a pooled connection; never more than MAX_CONCURRENT at once."""
    import asyncio
    running = peak = 0

    async def fake(items):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        return 0

    monkeypatch.setattr(push_service, "_deliver", fake)
    await asyncio.gather(*(push_service.deliver([]) for _ in range(5)))
    assert peak == push_service.MAX_CONCURRENT == 1


def test_backlog_beyond_cap_is_dropped(monkeypatch):
    monkeypatch.setattr(push_service, "_tasks", set(range(push_service.MAX_PENDING)))
    assert push_service._accepting() is False
    monkeypatch.setattr(push_service, "_tasks", set())
    assert push_service._accepting() is True


def test_push_title_names_the_event_and_offers_use_the_loud_channel():
    """Found 2026-11-15 on a device: every push read 'Sahayak / ...' and offers
    shared the quiet default channel, so a new job looked like any update."""
    pid = uuid.uuid4()
    tokens = {("partner", pid): ["ExponentPushToken[aaaaaaaaaaaa]"]}
    offer = push_service.build_messages(
        [{"recipient_type": "partner", "recipient_id": pid, "message": "You have a new job offer.",
          "event": "job_offered", "job_id": "j1"}], tokens)[0]
    assert offer["title"] == "New job offer"
    assert offer["channelId"] == "offers"

    update = push_service.build_messages(
        [{"recipient_type": "partner", "recipient_id": pid, "message": "x",
          "event": "job_cancelled_by_owner", "job_id": "j1"}], tokens)[0]
    assert update["title"] == "Job cancelled by owner"
    assert update["channelId"] == "jobs"

    unknown = push_service.build_messages(
        [{"recipient_type": "partner", "recipient_id": pid, "message": "x",
          "event": "something_new", "job_id": None}], tokens)[0]
    assert unknown["title"] == "Sahayak"
