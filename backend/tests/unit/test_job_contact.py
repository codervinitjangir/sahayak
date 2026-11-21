"""ADR-057 owner live location and ADR-058 job chat. No database, no Redis."""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.repositories import job_message_repository, job_repository
from app.schemas.job_contact import OwnerLocationUpdate
from app.services import job_contact_service as svc
from app.services import notification_service
from app.utils.errors import AppError, ErrorCode

OWNER = uuid.uuid4()
PARTNER = uuid.uuid4()
OTHER_PARTNER = uuid.uuid4()
JOB = uuid.uuid4()
NOW = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)


def ident(role, local_id):
    return SimpleNamespace(role=role, local_id=local_id, admin_role=None)


class FakeRedis:
    def __init__(self):
        self.store = {}

    async def set(self, k, v, ex=None):
        self.store[k] = (v, ex)

    async def get(self, k):
        return self.store.get(k, (None,))[0]

    async def delete(self, k):
        self.store.pop(k, None)


class FakeDB:
    committed = False

    async def commit(self):
        self.committed = True


@pytest.fixture
def world(monkeypatch):
    state = {"status": "partner_en_route", "assigned": PARTNER, "msgs": [], "pushes": []}
    redis = FakeRedis()
    monkeypatch.setattr(svc, "get_redis", lambda: redis)

    async def get_job(db, jid):
        return SimpleNamespace(id=JOB, user_id=OWNER, status=state["status"]) if jid == JOB else None

    async def responsible(db, jid):
        return SimpleNamespace(partner_id=state["assigned"]) if state["assigned"] else None

    async def add(db, **kw):
        at = NOW + timedelta(seconds=state.get("clock", 0))
        row = SimpleNamespace(id=uuid.uuid4(), created_at=at, **kw)
        state["msgs"].append(row)
        return row

    async def last(db, jid):
        return state["msgs"][-1] if state["msgs"] else None

    async def listing(db, jid, after=None):
        return [m for m in state["msgs"] if after is None or m.created_at > after]

    async def notify(db, **kw):
        state["pushes"].append(kw)

    monkeypatch.setattr(job_repository, "get_job_by_id", get_job)
    monkeypatch.setattr(job_repository, "get_responsible_assignment", responsible)
    monkeypatch.setattr(job_message_repository, "add_message", add)
    monkeypatch.setattr(job_message_repository, "last_message", last)
    monkeypatch.setattr(job_message_repository, "list_messages", listing)
    monkeypatch.setattr(notification_service, "notify_event", notify)
    state["redis"] = redis
    return state


def run(c):
    return asyncio.run(c)


def code_of(c):
    with pytest.raises(AppError) as e:
        run(c)
    return e.value.code


FIX = OwnerLocationUpdate(lat=12.97, lng=77.59, accuracy_m=8)


def test_the_accepted_partner_sees_the_owners_live_fix(world):
    run(svc.share_owner_location(FakeDB(), JOB, FIX, ident("user", OWNER)))
    v, ttl = world["redis"].store[svc.owner_location_key(JOB)]
    assert ttl == svc.OWNER_LOCATION_TTL_S and json.loads(v)["lat"] == 12.97
    got = run(svc.get_owner_location(FakeDB(), JOB, ident("partner", PARTNER)))
    assert got.sharing and got.lat == 12.97 and got.lng == 77.59


def test_an_offered_or_other_partner_gets_404_not_the_location(world):
    run(svc.share_owner_location(FakeDB(), JOB, FIX, ident("user", OWNER)))
    assert code_of(svc.get_owner_location(FakeDB(), JOB, ident("partner", OTHER_PARTNER))) == ErrorCode.JOB_NOT_FOUND
    world["assigned"] = None  # only offered, nobody accepted yet
    assert code_of(svc.get_owner_location(FakeDB(), JOB, ident("partner", PARTNER))) == ErrorCode.JOB_NOT_FOUND


def test_another_owner_cannot_write_and_an_ended_job_releases_nothing(world):
    assert code_of(svc.share_owner_location(FakeDB(), JOB, FIX, ident("user", uuid.uuid4()))) == ErrorCode.JOB_NOT_FOUND
    run(svc.share_owner_location(FakeDB(), JOB, FIX, ident("user", OWNER)))
    world["status"] = "completed"
    got = run(svc.get_owner_location(FakeDB(), JOB, ident("partner", PARTNER)))
    assert got.sharing is False and got.lat is None
    assert code_of(svc.share_owner_location(FakeDB(), JOB, FIX, ident("user", OWNER))) == ErrorCode.JOB_NOT_ACTIVE


def test_chat_both_ways_with_mine_flag_and_one_push_per_burst(world):
    db = FakeDB()
    run(svc.send_message(db, JOB, "Where are you?", ident("user", OWNER)))
    world["clock"] = 30
    run(svc.send_message(db, JOB, "Near the gate", ident("user", OWNER)))  # same sender, quiet window
    world["clock"] = 60
    run(svc.send_message(db, JOB, "5 minutes", ident("partner", PARTNER)))
    assert db.committed
    assert [p["recipient_type"] for p in world["pushes"]] == ["partner", "user"]
    assert all(p["event"] == "new_message" for p in world["pushes"])
    seen = run(svc.list_messages(FakeDB(), JOB, ident("partner", PARTNER)))
    assert [(m.sender, m.mine) for m in seen.items] == [("owner", False), ("owner", False), ("partner", True)]
    assert seen.can_send is True


def test_chat_is_closed_to_strangers_and_read_only_after_the_job(world):
    assert code_of(svc.send_message(FakeDB(), JOB, "hi", ident("partner", OTHER_PARTNER))) == ErrorCode.JOB_NOT_FOUND
    assert code_of(svc.list_messages(FakeDB(), JOB, ident("user", uuid.uuid4()))) == ErrorCode.JOB_NOT_FOUND
    world["status"] = "completed"
    assert code_of(svc.send_message(FakeDB(), JOB, "hi", ident("user", OWNER))) == ErrorCode.JOB_NOT_ACTIVE
    assert run(svc.list_messages(FakeDB(), JOB, ident("user", OWNER))).can_send is False
