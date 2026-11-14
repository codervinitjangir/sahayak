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
