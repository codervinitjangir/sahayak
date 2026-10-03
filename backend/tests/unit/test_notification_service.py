"""
Unit tests for the notification feed: the rule, the vocabulary, and the writer.

Split of responsibility with tests/integration/check_notifications.py: that
harness drives the real endpoints against real Postgres and is what proves the
rows actually land, that the indexes serve the queries and that a partner
cannot read an owner's feed. This module covers what a harness cannot reach
cheaply, or would only reach by accident —

  * **the recipient rule as a truth table.** `recipients_for` is the only place
    the system decides that an actor is not told about their own action. Driving
    it through a dispatch means one row of that table is exercised per test run
    and the rest are exercised never. Here every combination is pinned.
  * **the vocabulary's two halves agreeing.** Migration 005 deliberately left
    `event` without a CHECK constraint, on the argument that the service owns
    the vocabulary. This is the test that makes that argument true rather than
    a hope.
  * **the no-PII invariant, structurally.** Reading the message table and
    agreeing it looks fine is not a test. Asserting no template can interpolate
    anything is.
  * **that the writer does not commit and does not flush.** Both are load-
    bearing (ADR-019) and both are invisible in a passing integration run: a
    stray commit inside `notify_job_status_change` would split the status change
    from its history row and nothing about the feed would look wrong.
  * **the rollback path in `_transition`.** Same class of bug as
    test_rating_service's, and the same stub technique.

No database, no event loop fixture — pytest-asyncio is not installed here, so
every async call goes through asyncio.run(), same as the rest of tests/unit.
"""
import asyncio
import re
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import MissingGreenlet, OperationalError

from app.repositories import notification_repository
from app.services import notification_service
from app.services.auth_service import Identity
from app.services.notification_service import (
    EVENT_FOR_STATUS,
    NOTIFICATION_EVENTS,
    SILENT_STATUSES,
    event_for,
    recipients_for,
)
from app.utils.errors import ErrorCode, InternalError, NotFoundError

JOB_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OWNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
PARTNER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
PARTNER2_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
NOTIF_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
AUTH_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")

NOW = datetime(2026, 9, 30, 10, 0, 0, tzinfo=timezone.utc)

OWNER = Identity(auth_user_id=AUTH_ID, role="user", local_id=OWNER_ID)
PARTNER = Identity(auth_user_id=AUTH_ID, role="partner", local_id=PARTNER_ID)

# Every status the jobs CHECK constraint permits. Hard-coded rather than
# imported, so that adding a status to the schema without deciding what it
# notifies makes this file fail rather than silently defaulting.
ALL_JOB_STATUSES = (
    "requested",
    "matching",
    "assigned",
    "partner_en_route",
    "in_progress",
    "completed",
    "cancelled",
    "no_match_found",
)


class FakeJob:
    """Just the two attributes the writer reads off a Job."""

    def __init__(self, user_id=OWNER_ID, job_id=JOB_ID):
        self.id = job_id
        self.user_id = user_id


class FakeSession:
    """Records what was staged, flushed and committed. Nothing else."""

    def __init__(self):
        self.added = []
        self.flushes = 0
        self.commits = 0
        self.rollbacks = 0

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushes += 1

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status,actor_role,expected",
    [
        # Nobody acted: the dispatcher gave up. The owner is the only party.
        ("no_match_found", None, ("user",)),
        # The partner acted. Every one of these is the owner's news.
        ("assigned", "partner", ("user",)),
        ("partner_en_route", "partner", ("user",)),
        ("in_progress", "partner", ("user",)),
        ("completed", "partner", ("user",)),
        ("cancelled", "partner", ("user",)),
        # The owner acted. The partner is the one who needs to know.
        ("cancelled", "user", ("partner",)),
        # Silent regardless of who did it.
        ("requested", "user", ()),
        ("requested", None, ()),
        ("matching", None, ()),
        ("matching", "partner", ()),
    ],
)
def test_recipients_for_truth_table(status, actor_role, expected):
    """The whole of the recipient rule, one row per case.

    The two `cancelled` rows are the reason this is a rule and not a lookup
    table: the same status produces opposite recipients depending only on who
    caused it.
    """
    assert recipients_for(status, actor_role=actor_role) == expected


def test_actor_is_never_their_own_recipient():
    """The invariant the rule exists for, stated directly.

    Parametrised cases can be individually wrong in a way that still looks
    plausible. This asserts the property over every status instead: whoever
    acted is not in the result, ever.
    """
    for status in ALL_JOB_STATUSES:
        for actor in ("user", "partner"):
            assert actor not in recipients_for(status, actor_role=actor), (
                f"{actor} was notified of their own action on {status}"
            )


def test_every_non_silent_status_has_exactly_one_recipient():
    """No status notifies nobody, and none notifies both sides.

    Notifying both would mean telling somebody about something they did. A
    non-silent status notifying nobody would mean a status change that
    disappears — the feed's version of a silent transition, which principle 4
    rules out for the history table for the same reason.
    """
    for status in ALL_JOB_STATUSES:
        if status in SILENT_STATUSES:
            continue
        for actor in ("user", "partner", None):
            assert len(recipients_for(status, actor_role=actor)) == 1


# ---------------------------------------------------------------------------
# The vocabulary
# ---------------------------------------------------------------------------


def test_every_mapped_event_has_a_message():
    """EVENT_FOR_STATUS and NOTIFICATION_EVENTS cannot drift apart.

    This is what migration 005 traded a CHECK constraint for. Without it, adding
    a status to EVENT_FOR_STATUS and forgetting the message is a KeyError raised
    inside a dispatch transaction — i.e. a 500 on job completion, discovered in
    production.
    """
    for status, event in EVENT_FOR_STATUS.items():
        assert event in NOTIFICATION_EVENTS, f"{status} maps to unknown event {event}"


def test_actor_dependent_and_offer_events_are_in_the_vocabulary():
    """The three events no status maps to directly.

    `cancelled` resolves in event_for rather than through EVENT_FOR_STATUS, and
    `job_offered` has no status at all, so none of these three is covered by the
    test above — which is exactly how they would be the ones left out.
    """
    for event in (
        "job_cancelled_by_owner",
        "job_cancelled_by_partner",
        "job_offered",
    ):
        assert event in NOTIFICATION_EVENTS


def test_every_message_is_reachable():
    """No message in the table is dead.

    The other direction of the same check. An unreachable message is a kind of
    event somebody meant to emit and does not — cheaper to catch here than to
    notice from a feed that is quieter than expected.
    """
    reachable = set(EVENT_FOR_STATUS.values()) | {
        "job_cancelled_by_owner",
        "job_cancelled_by_partner",
        "job_offered",
    }
    assert set(NOTIFICATION_EVENTS) == reachable


def test_every_non_silent_status_maps_to_an_event():
    """Adding a job status without deciding what it says fails here."""
    for status in ALL_JOB_STATUSES:
        expected = status not in SILENT_STATUSES
        assert (event_for(status, actor_role="partner") is not None) is expected


def test_unknown_status_is_silent_rather_than_an_exception():
    """A status this module has never heard of writes nothing and does not raise.

    The writer runs inside somebody else's transaction. A KeyError here would
    fail a job completion because of a notification, which inverts which of the
    two matters.
    """
    assert event_for("teleported", actor_role="partner") is None


def test_cancellation_event_names_the_actor():
    assert event_for("cancelled", actor_role="user") == "job_cancelled_by_owner"
    assert event_for("cancelled", actor_role="partner") == "job_cancelled_by_partner"


# ---------------------------------------------------------------------------
# The no-PII invariant
# ---------------------------------------------------------------------------


def test_no_message_can_interpolate_anything():
    """No template placeholder in any message, so no value can be substituted in.

    This is the structural form of "notification text contains no names, phones
    or coordinates" (ADR-019). Asserting the current strings look clean would
    pass forever and prevent nothing; asserting they have no substitution points
    means the next person who wants to put a mechanic's name in a notification
    has to delete a test named after the reason they should not.
    """
    for event, message in NOTIFICATION_EVENTS.items():
        assert "{" not in message and "}" not in message, f"{event} has a placeholder"
        assert "%s" not in message and "%(" not in message, f"{event} has a %-format"
        assert "$" not in message, f"{event} has a $-substitution"


def test_no_message_contains_digits():
    """No phone number, no coordinate, no price, no distance.

    Digits are the cheap proxy for every identifier worth leaking. It also
    catches the subtler case the ADR is really about: a message that bakes in a
    number the reader is not entitled to *at read time*, because the gate that
    would have withheld it ran at write time or not at all.
    """
    for event, message in NOTIFICATION_EVENTS.items():
        assert not re.search(r"\d", message), f"{event} contains a digit: {message!r}"


# ---------------------------------------------------------------------------
# The writer
# ---------------------------------------------------------------------------


def test_writer_stages_one_row_addressed_to_the_owner():
    db = FakeSession()
    written = asyncio.run(
        notification_service.notify_job_status_change(
            db, job=FakeJob(), status="completed", actor_role="partner"
        )
    )
    assert written == 1
    (row,) = db.added
    assert row.recipient_type == "user"
    assert row.recipient_id == OWNER_ID
    assert row.event == "job_completed"
    assert row.job_id == JOB_ID
    assert row.channel == "in_app"
    assert row.is_read is False


def test_writer_neither_commits_nor_flushes():
    """The two things that must not happen inside somebody else's transaction.

    A commit would split the status change from its history row — the exact
    failure principle 4 forbids, one table over, and invisible in any test that
    only checks the feed. A flush would be a round trip per notification on the
    dispatch path, which the load-test report (§3) shows is what this system is
    actually short of.
    """
    db = FakeSession()
    asyncio.run(
        notification_service.notify_job_status_change(
            db, job=FakeJob(), status="completed", actor_role="partner"
        )
    )
    assert db.commits == 0
    assert db.flushes == 0


def test_silent_status_stages_nothing():
    db = FakeSession()
    written = asyncio.run(
        notification_service.notify_job_status_change(
            db, job=FakeJob(), status="matching", actor_role=None
        )
    )
    assert written == 0
    assert db.added == []


def test_owner_cancellation_notifies_every_open_partner():
    db = FakeSession()
    written = asyncio.run(
        notification_service.notify_job_status_change(
            db,
            job=FakeJob(),
            status="cancelled",
            actor_role="user",
            partner_ids=[PARTNER_ID, PARTNER2_ID],
        )
    )
    assert written == 2
    assert [r.recipient_id for r in db.added] == [PARTNER_ID, PARTNER2_ID]
    assert {r.event for r in db.added} == {"job_cancelled_by_owner"}
    # The owner cancelled; the owner is not told.
    assert all(r.recipient_type == "partner" for r in db.added)


def test_owner_cancellation_with_no_open_assignment_writes_nothing():
    """Cancelling from 'requested' is the ordinary case, not an error.

    A job nobody has been offered has nobody to tell. This must be zero rows and
    no exception — an earlier shape of this code would have written a row
    addressed to a partner_id of None, which the NOT NULL added by migration 005
    now refuses, and which would have failed the cancellation itself.
    """
    db = FakeSession()
    written = asyncio.run(
        notification_service.notify_job_status_change(
            db, job=FakeJob(), status="cancelled", actor_role="user", partner_ids=[]
        )
    )
    assert written == 0
    assert db.added == []


def test_ownerless_job_is_skipped_rather_than_failing_the_transaction():
    """jobs.user_id is nullable; notifications.recipient_id is not.

    A job with no owner should not exist, but the column permits one, and if it
    ever does the right outcome is a missing notification — not a completion
    that cannot be recorded because there was nobody to tell about it.
    """
    db = FakeSession()
    written = asyncio.run(
        notification_service.notify_job_status_change(
            db,
            job=FakeJob(user_id=None),
            status="completed",
            actor_role="partner",
        )
    )
    assert written == 0
    assert db.added == []


def test_offer_notification_addresses_the_partner():
    db = FakeSession()
    asyncio.run(
        notification_service.notify_offer(db, job_id=JOB_ID, partner_id=PARTNER_ID)
    )
    (row,) = db.added
    assert row.recipient_type == "partner"
    assert row.recipient_id == PARTNER_ID
    assert row.event == "job_offered"
    assert db.commits == 0


# ---------------------------------------------------------------------------
# The readers
# ---------------------------------------------------------------------------


class FakeRow:
    def __init__(self, is_read=False, notif_id=None):
        self.id = notif_id or uuid.uuid4()
        self.event = "job_completed"
        self.message = "Your request has been completed."
        self.job_id = JOB_ID
        self.is_read = is_read
        self.sent_at = NOW


def test_list_scopes_to_the_caller_and_never_to_a_parameter(monkeypatch):
    """The recipient pair comes off the token, and there is no other source.

    Principle 5. The endpoint has no parameter that names a recipient, so this
    asserts the last link: that the service passes the token's role and
    local_id through rather than anything else.
    """
    seen = {}

    async def fake_list(db, **kwargs):
        seen.update(kwargs)
        return [FakeRow()]

    async def fake_count(db, **kwargs):
        return 1

    monkeypatch.setattr(notification_repository, "list_for_recipient", fake_list)
    monkeypatch.setattr(notification_repository, "count_for_recipient", fake_count)

    asyncio.run(
        notification_service.list_notifications(
            FakeSession(), PARTNER, limit=20, offset=0
        )
    )
    assert seen["recipient_type"] == "partner"
    assert seen["recipient_id"] == PARTNER_ID


@pytest.mark.parametrize(
    "offset,page,total,expected",
    [
        # A full page with more behind it.
        (0, 20, 55, True),
        # The last page, which ends exactly on the boundary — the case
        # `len(rows) == limit` gets wrong, and the reason has_more is computed
        # from the total instead.
        (40, 20, 60, False),
        # A partial last page.
        (40, 5, 45, False),
        # An empty feed.
        (0, 0, 0, False),
        # Past the end.
        (100, 0, 60, False),
    ],
)
def test_has_more_is_computed_from_the_total(monkeypatch, offset, page, total, expected):
    async def fake_list(db, **kwargs):
        return [FakeRow() for _ in range(page)]

    async def fake_count(db, **kwargs):
        return total

    monkeypatch.setattr(notification_repository, "list_for_recipient", fake_list)
    monkeypatch.setattr(notification_repository, "count_for_recipient", fake_count)

    result = asyncio.run(
        notification_service.list_notifications(
            FakeSession(), OWNER, limit=20, offset=offset
        )
    )
    assert result.has_more is expected


def test_feed_item_carries_no_recipient_fields(monkeypatch):
    """The response shape does not echo who it is addressed to.

    Not privacy — the caller already knows — but contract hygiene: a client that
    can read `recipient_id` off a feed item is a client that can be written to
    filter on it, and then a change to how the server scopes the query becomes a
    client bug.
    """

    async def fake_list(db, **kwargs):
        return [FakeRow()]

    async def fake_count(db, **kwargs):
        return 1

    monkeypatch.setattr(notification_repository, "list_for_recipient", fake_list)
    monkeypatch.setattr(notification_repository, "count_for_recipient", fake_count)

    result = asyncio.run(
        notification_service.list_notifications(
            FakeSession(), OWNER, limit=20, offset=0
        )
    )
    body = result.items[0].model_dump()
    assert "recipient_id" not in body
    assert "recipient_type" not in body
    assert set(body) == {"id", "event", "message", "job_id", "is_read", "sent_at"}


def test_marking_an_already_read_notification_succeeds_with_zero(monkeypatch):
    """Idempotent, and reported as a success.

    A 409 here would be a failure response to the one caller who cannot tell the
    difference — a client retrying after a dropped response — while the server
    holds exactly the state that client asked for.
    """
    calls = {"exists": 0}

    async def fake_mark(db, **kwargs):
        return 0

    async def fake_exists(db, **kwargs):
        calls["exists"] += 1
        return True

    async def fake_count(db, **kwargs):
        return 3

    monkeypatch.setattr(notification_repository, "mark_read", fake_mark)
    monkeypatch.setattr(notification_repository, "exists_for_recipient", fake_exists)
    monkeypatch.setattr(notification_repository, "count_for_recipient", fake_count)

    db = FakeSession()
    result = asyncio.run(
        notification_service.mark_notification_read(db, OWNER, NOTIF_ID)
    )
    assert result.updated == 0
    assert result.unread_count == 3
    assert calls["exists"] == 1


def test_foreign_or_missing_notification_is_404(monkeypatch):
    """Same answer whether it belongs to someone else or to nobody.

    Principle 6, and it bites harder here than elsewhere: a notification's
    existence *is* the fact it carries, so a 403 on a foreign id would confirm
    that some other account was told something.
    """

    async def fake_mark(db, **kwargs):
        return 0

    async def fake_exists(db, **kwargs):
        return False

    monkeypatch.setattr(notification_repository, "mark_read", fake_mark)
    monkeypatch.setattr(notification_repository, "exists_for_recipient", fake_exists)

    with pytest.raises(NotFoundError) as excinfo:
        asyncio.run(
            notification_service.mark_notification_read(
                FakeSession(), OWNER, NOTIF_ID
            )
        )
    assert excinfo.value.code == ErrorCode.NOTIFICATION_NOT_FOUND
    assert excinfo.value.status_code == 404


def test_successful_mark_read_does_not_pay_for_the_existence_check(monkeypatch):
    """One round trip on the path that does work.

    The existence query exists only to disambiguate a zero. Running it
    unconditionally would put it on every call including every successful one,
    which is the version this deliberately does not do.
    """
    calls = {"exists": 0}

    async def fake_mark(db, **kwargs):
        return 1

    async def fake_exists(db, **kwargs):
        calls["exists"] += 1
        return True

    async def fake_count(db, **kwargs):
        return 0

    monkeypatch.setattr(notification_repository, "mark_read", fake_mark)
    monkeypatch.setattr(notification_repository, "exists_for_recipient", fake_exists)
    monkeypatch.setattr(notification_repository, "count_for_recipient", fake_count)

    result = asyncio.run(
        notification_service.mark_notification_read(FakeSession(), OWNER, NOTIF_ID)
    )
    assert result.updated == 1
    assert calls["exists"] == 0


def test_mark_all_read_does_not_requery_the_count(monkeypatch):
    """Zero is guaranteed by the statement, so it is not asked for."""
    calls = {"count": 0}

    async def fake_mark_all(db, **kwargs):
        return 7

    async def fake_count(db, **kwargs):
        calls["count"] += 1
        return 99

    monkeypatch.setattr(notification_repository, "mark_all_read", fake_mark_all)
    monkeypatch.setattr(notification_repository, "count_for_recipient", fake_count)

    result = asyncio.run(
        notification_service.mark_all_notifications_read(FakeSession(), OWNER)
    )
    assert result.updated == 7
    assert result.unread_count == 0
    assert calls["count"] == 0


# ---------------------------------------------------------------------------
# The seam the writer was added to
# ---------------------------------------------------------------------------


class ExpirableJob:
    """A Job that goes expired on rollback, the way a real one does.

    Session.rollback() expires every object in the identity map
    unconditionally — unlike commit(), which AsyncSessionLocal opts out of with
    expire_on_commit=False. Reading an attribute off an expired instance emits a
    lazy SELECT, and on an AsyncSession outside a greenlet context that raises
    MissingGreenlet. Same stub as tests/unit/test_rating_service.py's, for the
    same class of bug in a different service.
    """

    def __init__(self):
        self._expired = False
        self._id = JOB_ID
        self.user_id = OWNER_ID
        self.status = "matching"

    @property
    def id(self):
        if self._expired:
            raise MissingGreenlet(
                "greenlet_spawn has not been called; can't call await_only() here"
            )
        return self._id

    def expire(self):
        self._expired = True


class ExpiringSession(FakeSession):
    def __init__(self, job):
        super().__init__()
        self._job = job

    async def rollback(self):
        self.rollbacks += 1
        self._job.expire()


def test_transition_failure_reports_itself_instead_of_dying_in_the_handler():
    """_transition's error path must not read the Job after rolling back.

    The except block logs `job_id`, and the rollback immediately above it has
    already expired the instance that id lives on — so reading it raises
    MissingGreenlet *out of the error handler*, replacing a mapped 500 "Could
    not update the job status" with an unrelated SQLAlchemy error and losing
    the log line that said what actually failed.

    This is a pre-existing bug in dispatch_service, not one the notification
    work introduced. It is fixed here rather than filed because adding a third
    write inside that try block is precisely what makes the handler likelier to
    run. The fix is one line: capture the id before the try.
    """
    from app.repositories import dispatch_repository
    from app.services import dispatch_service

    job = ExpirableJob()
    db = ExpiringSession(job)

    async def boom(_db, _job, _status):
        raise OperationalError("UPDATE jobs", {}, Exception("connection lost"))

    original = dispatch_repository.set_job_status
    dispatch_repository.set_job_status = boom
    try:
        with pytest.raises(InternalError) as excinfo:
            asyncio.run(
                dispatch_service._transition(
                    db, job, "no_match_found", note="No available partner"
                )
            )
    finally:
        dispatch_repository.set_job_status = original

    assert excinfo.value.status_code == 500
    assert db.rollbacks == 1

