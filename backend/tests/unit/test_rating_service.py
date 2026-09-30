"""
Unit tests for the rating service, the schema, and the aggregate contract.

Split of responsibility with tests/integration/check_ratings.py: that harness
drives the real endpoints against real Postgres and is what proves the aggregate
arithmetic, because the aggregate is one SQL statement and SQL is not testable
against a stub. This module covers what it cannot reach cheaply, or cannot reach
at all —

  * **the rollback path.** check_ratings.py exercises it and caught a real bug
    there (see test_conflict_survives_the_rollback below), but a harness can only
    catch that bug once the constraint actually fires. Here it is pinned
    directly, so the next person to add a `log_event` to a failure branch finds
    out from a test named after the problem.
  * **the non-locking read of `jobs`.** A deliberate, documented deviation from
    CLAUDE.md principle 7. A deviation nobody can see in a test is a deviation
    somebody eventually "fixes", so the stub asserts on being asked for the
    locking read at all.
  * **call ordering.** That the partners lock is taken *before* the insert is the
    whole of this path's concurrency control. Against real Postgres a wrong order
    still passes every single-threaded run.
  * **which direction feeds the aggregate.** A partner rating an owner must not
    touch the partner's own score. The harness proves it for one score; this
    proves the recompute is not called at all, which is the stronger statement.
  * **the schema's refusals**, where a Pydantic model is the only thing standing
    between a request body and an identity the caller does not own.

No database, no event loop fixture — pytest-asyncio is not installed here, so
every async call goes through asyncio.run(), same as the rest of tests/unit.
"""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, MissingGreenlet, OperationalError

from app.repositories import dispatch_repository, job_repository, rating_repository
from app.schemas.rating import RatingCreateRequest
from app.services import rating_service
from app.services.auth_service import Identity
from app.utils.errors import (
    ConflictError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
)

JOB_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OWNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
PARTNER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
OTHER_ID = uuid.UUID("99999999-9999-9999-9999-999999999999")
RATING_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
AUTH_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")

NOW = datetime(2026, 9, 29, 10, 0, 0, tzinfo=timezone.utc)

OWNER = Identity(auth_user_id=AUTH_ID, role="user", local_id=OWNER_ID)
PARTNER = Identity(auth_user_id=AUTH_ID, role="partner", local_id=PARTNER_ID)
BYSTANDER = Identity(auth_user_id=AUTH_ID, role="partner", local_id=OTHER_ID)
OTHER_OWNER = Identity(auth_user_id=AUTH_ID, role="user", local_id=OTHER_ID)


class ExpirableJob:
    """A Job row that goes expired on rollback, the way a real one does.

    This is the single most important stub in the file, and it is a stub of
    SQLAlchemy's behaviour rather than of the database's.

    `Session.rollback()` expires every object in the identity map —
    unconditionally, unlike `commit()`, which AsyncSessionLocal opts out of with
    `expire_on_commit=False`. Reading an attribute off an expired object emits a
    lazy SELECT, and on an AsyncSession a lazy SELECT is not a slow query, it is
    a MissingGreenlet. So an except block that logs `job.id` after rolling back
    raises out of its own handler and the mapped error never reaches the client.

    A plain object stub cannot express that: every attribute keeps working after
    the rollback, the test passes, and production serves a 500 where a 409
    belongs.
    """

    def __init__(self, *, status: str = "completed", user_id: uuid.UUID = OWNER_ID):
        self._data = {"id": JOB_ID, "user_id": user_id, "status": status}
        self._expired = False

    def expire(self) -> None:
        self._expired = True

    def __getattr__(self, name):
        data = object.__getattribute__(self, "_data")
        if name not in data:
            raise AttributeError(name)
        if object.__getattribute__(self, "_expired"):
            raise MissingGreenlet(
                "greenlet_spawn has not been called; can't call await_only() here"
            )
        return data[name]


class FakeAssignment:
    def __init__(self, partner_id: uuid.UUID = PARTNER_ID):
        self.partner_id = partner_id


class FakeRating:
    def __init__(self, *, rated_by: str, rating: int = 5, comment=None):
        self.id = RATING_ID
        self.job_id = JOB_ID
        self.rated_by = rated_by
        self.rating = rating
        self.comment = comment
        self.created_at = NOW


class FakeSession:
    """Records the transaction verbs, and expires the job on rollback.

    `execute` raises rather than returning None: every query on this path goes
    through a repository, so reaching the session directly means something was
    left unstubbed and the test would otherwise pass on a None it never checked.
    """

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False
        self.refreshed: list = []
        self.job: ExpirableJob | None = None

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True
        if self.job is not None:
            self.job.expire()

    async def refresh(self, obj) -> None:
        self.refreshed.append(obj)

    async def execute(self, _stmt):
        raise AssertionError("a repository call was not stubbed")


@pytest.fixture
def wiring(monkeypatch):
    """Stub every repository this service touches; return the call log.

    `calls` is an ordered list of names, which is what makes the lock-before-
    insert assertion possible. `state` lets a test change what the stubs return
    without redefining them.
    """
    calls: list[str] = []
    state = {
        "job": ExpirableJob(),
        "assignment": FakeAssignment(),
        "create_raises": None,
        "aggregate": ("4.5", 2),
        "ratings": [],
    }

    async def get_job_by_id(db, job_id):
        calls.append("get_job_by_id")
        job = state["job"]
        if isinstance(db, FakeSession):
            db.job = job
        return job

    async def get_job_by_id_for_update(db, job_id):
        # Not a stub — an assertion. The non-locking read on this path is a
        # documented deviation from principle 7 (see submit_rating's docstring),
        # and the point of failing here is that "tighten this up" is a plausible
        # thing for a future reader to do without reading the reasoning.
        raise AssertionError(
            "submit_rating must not take a row lock on jobs — see ADR-018 and "
            "the deviation note in rating_service.submit_rating"
        )

    async def get_responsible_assignment(db, job_id):
        calls.append("get_responsible_assignment")
        return state["assignment"]

    async def lock_partner_for_update(db, partner_id):
        calls.append(f"lock_partner:{partner_id}")
        return object()

    async def create_rating_row(db, *, job_id, rated_by, rating, comment):
        calls.append("create_rating_row")
        state["created"] = {
            "job_id": job_id, "rated_by": rated_by,
            "rating": rating, "comment": comment,
        }
        if state["create_raises"] is not None:
            raise state["create_raises"]
        return FakeRating(rated_by=rated_by, rating=rating, comment=comment)

    async def recompute_partner_rating(db, partner_id):
        calls.append(f"recompute:{partner_id}")
        return state["aggregate"]

    async def get_ratings_for_job(db, job_id):
        calls.append("get_ratings_for_job")
        return state["ratings"]

    monkeypatch.setattr(job_repository, "get_job_by_id", get_job_by_id)
    monkeypatch.setattr(
        job_repository, "get_job_by_id_for_update", get_job_by_id_for_update
    )
    monkeypatch.setattr(
        job_repository, "get_responsible_assignment", get_responsible_assignment
    )
    monkeypatch.setattr(
        dispatch_repository, "lock_partner_for_update", lock_partner_for_update
    )
    monkeypatch.setattr(rating_repository, "create_rating_row", create_rating_row)
    monkeypatch.setattr(
        rating_repository, "recompute_partner_rating", recompute_partner_rating
    )
    monkeypatch.setattr(rating_repository, "get_ratings_for_job", get_ratings_for_job)

    return {"calls": calls, "state": state}


def submit(identity, rating=5, comment=None, session=None):
    session = session or FakeSession()
    payload = RatingCreateRequest(rating=rating, comment=comment)
    return session, asyncio.run(
        rating_service.submit_rating(session, JOB_ID, payload, identity)
    )


# --------------------------------------------------------------------------
# The bug the control run found
# --------------------------------------------------------------------------
def test_conflict_survives_the_rollback(wiring):
    """A duplicate rating must produce 409, not a MissingGreenlet out of the handler.

    The regression: the except block logged `str(job.id)`, and `db.rollback()`
    had just expired `job`. The attribute read tried to reload the row, which on
    an AsyncSession raises, so the `ConflictError` on the next line was never
    constructed — the client got a 500 for what is a completely ordinary "you
    already rated this" tap.

    Caught by check_ratings.py section 7 on the first run. Pinned here because
    the trigger for it is one attribute read in a branch that only a constraint
    violation reaches, and every later failure branch added to this service will
    have the same hazard.
    """
    wiring["state"]["create_raises"] = IntegrityError(
        "INSERT INTO ratings ...", {},
        Exception('duplicate key value violates unique constraint '
                  '"ratings_job_id_rated_by_key"'),
    )
    session = FakeSession()

    with pytest.raises(ConflictError) as exc:
        submit(OWNER, session=session)

    assert exc.value.status_code == 409
    assert exc.value.code == ErrorCode.RATING_ALREADY_SUBMITTED
    assert session.rolled_back is True
    assert session.committed is False


def test_write_failure_survives_the_rollback_too(wiring):
    """The same hazard on the 500 branch, which no constraint will ever reach.

    Separate test rather than a parametrize: this branch is unreachable from the
    integration harness by construction — there is no request that makes Postgres
    fail on demand — so this is the *only* thing that exercises it.
    """
    wiring["state"]["create_raises"] = OperationalError(
        "INSERT INTO ratings ...", {}, Exception("server closed the connection")
    )
    session = FakeSession()

    with pytest.raises(InternalError) as exc:
        submit(OWNER, session=session)

    assert exc.value.status_code == 500
    assert session.rolled_back is True
    assert session.committed is False


# --------------------------------------------------------------------------
# Direction comes from the token
# --------------------------------------------------------------------------
def test_owner_rating_is_stored_as_user(wiring):
    """`rated_by` is derived from the verified role, never supplied (principle 5)."""
    _, row = submit(OWNER)
    assert wiring["state"]["created"]["rated_by"] == "user"
    assert row.rated_by == "user"


def test_partner_rating_is_stored_as_partner(wiring):
    _, row = submit(PARTNER)
    assert wiring["state"]["created"]["rated_by"] == "partner"
    assert row.rated_by == "partner"


def test_job_id_comes_from_the_path_not_the_body(wiring):
    """The row is written against the path's job, which is the one that was authorised."""
    submit(OWNER)
    assert wiring["state"]["created"]["job_id"] == JOB_ID


def test_score_and_comment_are_passed_through_unmodified(wiring):
    submit(OWNER, rating=3, comment="Arrived late but fixed it.")
    created = wiring["state"]["created"]
    assert created["rating"] == 3
    assert created["comment"] == "Arrived late but fixed it."


# --------------------------------------------------------------------------
# Which direction feeds the aggregate
# --------------------------------------------------------------------------
def test_owner_rating_locks_the_partner_then_inserts_then_recomputes(wiring):
    """Order is the concurrency control, and a wrong order passes any serial run.

    The lock must precede the insert: two owners rating two different jobs of the
    same mechanic share no job row, so the partners row is the only thing that
    serialises them. Recompute after the insert, as a separate statement, so
    READ COMMITTED gives it a snapshot that includes whichever insert won.
    """
    submit(OWNER)
    calls = wiring["calls"]
    assert calls == [
        "get_job_by_id",
        "get_responsible_assignment",
        f"lock_partner:{PARTNER_ID}",
        "create_rating_row",
        f"recompute:{PARTNER_ID}",
    ]


def test_partner_rating_never_touches_the_partner_aggregate(wiring):
    """A mechanic's review of an owner must not move the mechanic's own score.

    Asserted as "recompute was not called" rather than "the number did not
    change": an implementation that recomputed and happened to get the same
    answer would pass the weaker check and then be wrong the day `users` grows
    rating columns and someone reuses this path for them.
    """
    submit(PARTNER)
    calls = wiring["calls"]
    assert not any(c.startswith("recompute") for c in calls), calls
    assert not any(c.startswith("lock_partner") for c in calls), calls
    assert "create_rating_row" in calls


def test_owner_rating_with_no_responsible_assignment_is_still_stored(wiring):
    """A data fault is not the rater's fault, and the rating is not lost work.

    A completed job always has a responsible assignment — it is how it reached
    'completed'. If one is missing anyway, store the rating and skip the
    aggregate rather than refusing a legitimate rater over something they cannot
    clear. Recomputing from source is what makes this safe: repairing the
    assignment later makes this row count on the partner's next rating, with no
    backfill.
    """
    wiring["state"]["assignment"] = None
    session, row = submit(OWNER)

    assert row.rated_by == "user"
    assert session.committed is True
    calls = wiring["calls"]
    assert "create_rating_row" in calls
    assert not any(c.startswith("recompute") for c in calls), calls
    assert not any(c.startswith("lock_partner") for c in calls), calls


# --------------------------------------------------------------------------
# The non-locking read, and the order of refusals
# --------------------------------------------------------------------------
def test_jobs_row_is_read_without_a_lock(wiring):
    """Documented deviation from principle 7 — pinned so it stays deliberate.

    'completed' is terminal, so a read that sees it cannot stop being true, and a
    read that sees anything else yields a truthful 409 for the instant it was
    taken. Locking would write-lock the jobs row of every finished job for the
    duration of a rating and buy nothing. The stub for the locking read raises,
    so this test is really "the service did not quietly start locking".
    """
    submit(OWNER)
    assert wiring["calls"][0] == "get_job_by_id"


def test_unknown_job_is_404(wiring):
    wiring["state"]["job"] = None
    with pytest.raises(NotFoundError) as exc:
        submit(OWNER)
    assert exc.value.code == ErrorCode.JOB_NOT_FOUND


def test_someone_elses_job_is_403(wiring):
    wiring["state"]["job"] = ExpirableJob(user_id=OTHER_ID)
    with pytest.raises(ForbiddenError):
        submit(OWNER)


def test_unassigned_partner_is_403(wiring):
    with pytest.raises(ForbiddenError):
        submit(BYSTANDER)


def test_partner_on_a_job_with_no_assignment_is_403(wiring):
    """No responsible assignment means no partner is a party to it.

    The mirror of test_owner_rating_with_no_responsible_assignment_is_still_stored:
    the same data fault is tolerated for the owner, whose claim is established by
    `jobs.user_id`, and refused for a partner, whose only claim *is* the
    assignment. Tolerating it there would let any verified mechanic rate the job.
    """
    wiring["state"]["assignment"] = None
    with pytest.raises(ForbiddenError):
        submit(PARTNER)


def test_unfinished_job_is_409(wiring):
    wiring["state"]["job"] = ExpirableJob(status="in_progress")
    with pytest.raises(ConflictError) as exc:
        submit(OWNER)
    assert exc.value.code == ErrorCode.JOB_NOT_RATEABLE


def test_forbidden_beats_not_rateable(wiring):
    """403 before 409, so a stranger learns nothing about the job's state.

    Both conditions are true here: the job belongs to someone else *and* it is
    not completed. A 409 would confirm the job exists and disclose where it is in
    its lifecycle to a caller with no claim on it.
    """
    wiring["state"]["job"] = ExpirableJob(status="requested", user_id=OTHER_ID)
    with pytest.raises(ForbiddenError):
        submit(OWNER)


def test_nothing_is_written_when_a_check_refuses(wiring):
    """Every refusal happens before the transaction opens."""
    wiring["state"]["job"] = ExpirableJob(status="assigned")
    session = FakeSession()
    with pytest.raises(ConflictError):
        submit(OWNER, session=session)
    assert "create_rating_row" not in wiring["calls"]
    assert session.committed is False
    assert session.rolled_back is False


# --------------------------------------------------------------------------
# created_at, which the INSERT alone does not populate
# --------------------------------------------------------------------------
def test_row_is_refreshed_before_it_is_returned(wiring):
    """`created_at` is a server default, so the ORM object does not have it yet.

    Without the explicit refresh the route's response serialisation reads it, the
    ORM emits a lazy SELECT, and the same MissingGreenlet as the rollback bug
    surfaces — this time on the success path.
    """
    session, row = submit(OWNER)
    assert session.refreshed == [row]
    assert session.committed is True


# --------------------------------------------------------------------------
# get_job_ratings: can_rate is the field clients branch on
# --------------------------------------------------------------------------
def read(identity, session=None):
    session = session or FakeSession()
    return session, asyncio.run(
        rating_service.get_job_ratings(session, JOB_ID, identity)
    )


def test_can_rate_is_true_for_a_completed_unrated_job(wiring):
    _, (status, ratings, can_rate) = read(OWNER)
    assert status == "completed"
    assert ratings == []
    assert can_rate is True


def test_can_rate_is_false_while_the_job_is_unfinished(wiring):
    wiring["state"]["job"] = ExpirableJob(status="in_progress")
    _, (status, _, can_rate) = read(OWNER)
    assert status == "in_progress"
    assert can_rate is False


def test_can_rate_is_per_side_not_per_job(wiring):
    """The owner having rated must not close the partner's slot.

    The failure this guards against is a one-character one — `if ratings` instead
    of a `rated_by` comparison — and it would hide the mechanic's half of a
    two-way exchange behind a form that never appears.
    """
    wiring["state"]["ratings"] = [FakeRating(rated_by="user")]

    _, (_, _, owner_can_rate) = read(OWNER)
    _, (_, _, partner_can_rate) = read(PARTNER)

    assert owner_can_rate is False
    assert partner_can_rate is True


def test_both_ratings_close_both_slots(wiring):
    wiring["state"]["ratings"] = [
        FakeRating(rated_by="partner"), FakeRating(rated_by="user"),
    ]
    _, (_, ratings, owner_can_rate) = read(OWNER)
    _, (_, _, partner_can_rate) = read(PARTNER)

    assert len(ratings) == 2
    assert owner_can_rate is False
    assert partner_can_rate is False


def test_reading_is_authorised_the_same_way_as_writing(wiring):
    with pytest.raises(ForbiddenError):
        read(BYSTANDER)
    with pytest.raises(ForbiddenError):
        read(OTHER_OWNER)


def test_reading_an_unknown_job_is_404(wiring):
    wiring["state"]["job"] = None
    with pytest.raises(NotFoundError) as exc:
        read(OWNER)
    assert exc.value.code == ErrorCode.JOB_NOT_FOUND


def test_the_read_path_opens_no_transaction(wiring):
    """A GET a client may poll must not commit, roll back, or lock."""
    session, _ = read(OWNER)
    assert session.committed is False
    assert session.rolled_back is False
    assert not any(c.startswith("lock_partner") for c in wiring["calls"])


# --------------------------------------------------------------------------
# The schema is what stops a body from claiming an identity
# --------------------------------------------------------------------------
def test_rated_by_in_the_body_is_rejected():
    """Not ignored — rejected.

    With `extra="forbid"` this is a 422. Silently dropping it would be worse than
    it looks: a client that believes it is sending `rated_by` gets a 201 and the
    opposite row from the one it meant to write, and nothing in the response
    contradicts it.
    """
    with pytest.raises(ValidationError):
        RatingCreateRequest(rating=5, rated_by="partner")


def test_job_id_in_the_body_is_rejected():
    with pytest.raises(ValidationError):
        RatingCreateRequest(rating=5, job_id=str(JOB_ID))


@pytest.mark.parametrize("value", [0, 6, -1, 100])
def test_scores_outside_one_to_five_are_rejected(value):
    with pytest.raises(ValidationError):
        RatingCreateRequest(rating=value)


@pytest.mark.parametrize("value", [1, 2, 3, 4, 5])
def test_every_score_in_range_is_accepted(value):
    assert RatingCreateRequest(rating=value).rating == value


def test_rating_is_required():
    with pytest.raises(ValidationError):
        RatingCreateRequest()


@pytest.mark.parametrize("value", ["", "   ", "\n\t "])
def test_blank_comment_normalises_to_none(value):
    """So "did they leave a note" is one IS NULL check, whatever the client sent.

    Two clients disagreeing about whether an untouched textarea sends "" or is
    omitted is normal; the database carrying both spellings of "nothing" is not.
    """
    assert RatingCreateRequest(rating=5, comment=value).comment is None


def test_comment_is_trimmed_of_nothing_it_should_keep():
    assert RatingCreateRequest(rating=5, comment="  Good work  ").comment is not None


def test_overlong_comment_is_rejected():
    with pytest.raises(ValidationError):
        RatingCreateRequest(rating=5, comment="x" * 1001)


def test_comment_at_the_limit_is_accepted():
    assert len(RatingCreateRequest(rating=5, comment="x" * 1000).comment) == 1000
