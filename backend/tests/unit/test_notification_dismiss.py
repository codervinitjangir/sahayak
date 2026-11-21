"""ADR-054: clearing notifications from the panel (soft dismiss)."""
import asyncio
import uuid

import pytest
from sqlalchemy.dialects import postgresql

from app.utils.errors import ErrorCode, NotFoundError
from app.repositories import notification_repository
from app.services import notification_service
from app.services.auth_service import Identity

OWNER = Identity(auth_user_id=uuid.uuid4(), role="user", local_id=uuid.uuid4())
NOTIF_ID = uuid.uuid4()


class FakeSession:
    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1


def test_every_read_path_filters_out_dismissed_rows():
    """The single recipient filter carries the dismissed clause, so the list,
    the count and the badge cannot disagree about what was cleared."""
    clauses = notification_repository._recipient_filter("user", uuid.uuid4())
    sql = " ".join(
        str(c.compile(dialect=postgresql.dialect())) for c in clauses
    )
    assert "dismissed_at IS NULL" in sql


def test_dismiss_statement_sets_read_and_dismissed_and_scopes_to_the_caller():
    captured = {}

    class Capture:
        async def execute(self, stmt):
            captured["sql"] = str(stmt.compile(dialect=postgresql.dialect()))

            class R:
                rowcount = 1
            return R()

    n = asyncio.run(notification_repository.dismiss(
        Capture(), recipient_type="partner", recipient_id=uuid.uuid4(),
        notification_id=NOTIF_ID))
    assert n == 1
    sql = captured["sql"]
    assert "dismissed_at=now()" in sql and "is_read=" in sql
    assert "recipient_type" in sql and "recipient_id" in sql and "notifications.id" in sql


def test_clear_all_has_no_id_clause():
    captured = {}

    class Capture:
        async def execute(self, stmt):
            captured["sql"] = str(stmt.compile(dialect=postgresql.dialect()))

            class R:
                rowcount = 4
            return R()

    n = asyncio.run(notification_repository.dismiss(
        Capture(), recipient_type="user", recipient_id=uuid.uuid4()))
    assert n == 4
    assert "notifications.id =" not in captured["sql"]


def test_dismissing_twice_is_a_200_with_zero(monkeypatch):
    async def fake_dismiss(db, **kw):
        return 0

    async def fake_ever(db, **kw):
        return True

    async def fake_count(db, **kw):
        return 2

    monkeypatch.setattr(notification_repository, "dismiss", fake_dismiss)
    monkeypatch.setattr(notification_repository, "ever_existed_for_recipient", fake_ever)
    monkeypatch.setattr(notification_repository, "count_for_recipient", fake_count)
    result = asyncio.run(notification_service.dismiss_notification(FakeSession(), OWNER, NOTIF_ID))
    assert (result.updated, result.unread_count) == (0, 2)


def test_dismissing_someone_elses_notification_is_404(monkeypatch):
    async def fake_dismiss(db, **kw):
        return 0

    async def fake_ever(db, **kw):
        return False

    monkeypatch.setattr(notification_repository, "dismiss", fake_dismiss)
    monkeypatch.setattr(notification_repository, "ever_existed_for_recipient", fake_ever)
    db = FakeSession()
    with pytest.raises(NotFoundError) as e:
        asyncio.run(notification_service.dismiss_notification(db, OWNER, NOTIF_ID))
    assert e.value.code == ErrorCode.NOTIFICATION_NOT_FOUND
    assert db.commits == 0


def test_clear_all_commits_and_reports_zero_unread(monkeypatch):
    seen = {}

    async def fake_dismiss(db, **kw):
        seen.update(kw)
        return 9

    monkeypatch.setattr(notification_repository, "dismiss", fake_dismiss)
    db = FakeSession()
    result = asyncio.run(notification_service.clear_all_notifications(db, OWNER))
    assert (result.updated, result.unread_count, db.commits) == (9, 0, 1)
    assert "notification_id" not in seen
