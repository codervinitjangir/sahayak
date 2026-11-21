"""Sahayak Care memberships (ADR-051): counting, linking, staff grant/revoke."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.repositories import admin_ops_repository, care_repository
from app.services import care_service
from app.utils.auth import STAFF_WRITE_ROLES
from app.utils.errors import AppError

NOW = datetime(2026, 11, 21, 6, 0, tzinfo=timezone.utc)
USER = uuid.uuid4()
ADMIN = SimpleNamespace(local_id=uuid.uuid4(), role="admin", admin_role="ops")


class FakeSession:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def _membership(**kw):
    base = dict(id=uuid.uuid4(), user_id=USER, plan_id=1, callouts_allowed=4,
                starts_at=NOW - timedelta(days=10), ends_at=NOW + timedelta(days=355),
                revoked_at=None, revoke_reason=None)
    base.update(kw)
    return SimpleNamespace(**base)


def run(coro):
    return asyncio.run(coro)


def test_in_force_window_and_revocation():
    m = _membership()
    assert care_service.is_in_force(m, NOW)
    assert not care_service.is_in_force(m, m.ends_at)            # end is exclusive
    assert not care_service.is_in_force(_membership(starts_at=NOW + timedelta(seconds=1)), NOW)
    assert not care_service.is_in_force(_membership(revoked_at=NOW, revoke_reason="x"), NOW)


def test_callouts_left_never_negative():
    assert care_service.callouts_left(4, 1) == 3
    assert care_service.callouts_left(4, 6) == 0


def test_cancelled_and_unmatched_jobs_give_the_callout_back():
    assert set(care_repository.RELEASING_STATUSES) == {"cancelled", "no_match_found"}


@pytest.mark.parametrize("used, linked", [(0, True), (3, True), (4, False)])
def test_new_job_links_only_while_a_callout_is_left(monkeypatch, used, linked):
    m = _membership()
    seen = {}

    async def current(db, user_id, now, *, for_update=False):
        seen["for_update"] = for_update
        return m

    async def count(db, membership_id):
        return used

    monkeypatch.setattr(care_repository, "get_current_membership", current)
    monkeypatch.setattr(care_repository, "count_callouts_used", count)
    got = run(care_service.membership_for_new_job(FakeSession(), USER, NOW))
    assert (got == m.id) is linked
    assert seen["for_update"] is True        # the count runs under the membership row lock


def test_no_membership_means_no_link(monkeypatch):
    async def current(db, user_id, now, *, for_update=False):
        return None

    monkeypatch.setattr(care_repository, "get_current_membership", current)
    assert run(care_service.membership_for_new_job(FakeSession(), USER, NOW)) is None


def _grant_stubs(monkeypatch, *, user=True, plan=True, current=None):
    added = {}

    async def get_user_for_update(db, user_id):
        return SimpleNamespace(id=user_id) if user else None

    async def get_plan_by_code(db, code):
        return SimpleNamespace(id=1, code=code, name="Sahayak Care", callouts=4, term_days=365,
                               is_active=True) if plan else None

    async def get_current_membership(db, user_id, now, *, for_update=False):
        return current

    async def add_membership(db, **fields):
        added.update(fields)
        return SimpleNamespace(id=uuid.uuid4(), **fields)

    async def add_audit(db, **kw):
        added["audit"] = kw

    async def view(db, user_id):
        return "view"

    monkeypatch.setattr(admin_ops_repository, "get_user_for_update", get_user_for_update)
    monkeypatch.setattr(care_repository, "get_plan_by_code", get_plan_by_code)
    monkeypatch.setattr(care_repository, "get_current_membership", get_current_membership)
    monkeypatch.setattr(care_repository, "add_membership", add_membership)
    monkeypatch.setattr(admin_ops_repository, "add_audit", add_audit)
    monkeypatch.setattr(care_service, "user_care_for_staff", view)
    return added


def test_grant_snapshots_the_plan_and_audits(monkeypatch):
    added = _grant_stubs(monkeypatch)
    db = FakeSession()
    assert run(care_service.grant(db, USER, plan_code="care", reason="pilot owner", identity=ADMIN)) == "view"
    assert added["callouts_allowed"] == 4
    assert (added["ends_at"] - added["starts_at"]) == timedelta(days=365)
    assert added["audit"]["action"] == "care_granted" and added["audit"]["target_type"] == "user"
    assert db.commits == 1


@pytest.mark.parametrize("kw, code", [
    (dict(current=_membership()), "CARE_ALREADY_ACTIVE"),
    (dict(plan=False), "CARE_PLAN_NOT_FOUND"),
    (dict(user=False), "USER_NOT_FOUND"),
])
def test_grant_refusals_write_nothing(monkeypatch, kw, code):
    added = _grant_stubs(monkeypatch, **kw)
    db = FakeSession()
    with pytest.raises(AppError) as exc:
        run(care_service.grant(db, USER, plan_code="care", reason="pilot owner", identity=ADMIN))
    assert exc.value.code == code
    assert "audit" not in added and db.commits == 0 and db.rollbacks == 1


def test_revoke_without_a_membership_is_409(monkeypatch):
    _grant_stubs(monkeypatch, current=None)
    with pytest.raises(AppError) as exc:
        run(care_service.revoke(FakeSession(), USER, reason="left the pilot", identity=ADMIN))
    assert exc.value.code == "CARE_NOT_ACTIVE"


def test_revoke_ends_it_now_and_audits(monkeypatch):
    m = _membership()
    added = _grant_stubs(monkeypatch, current=m)
    db = FakeSession()
    run(care_service.revoke(db, USER, reason="left the pilot", identity=ADMIN))
    assert m.revoked_at is not None and m.revoke_reason == "left the pilot" and m.revoked_by == ADMIN.local_id
    assert added["audit"]["action"] == "care_revoked" and db.commits == 1


def test_only_ops_and_super_admin_may_grant():
    assert STAFF_WRITE_ROLES["care"] == ("super_admin", "ops")


def test_pricing_note_says_the_price_does_not_change():
    assert "price is the same" in care_service.PRICING_NOTE
