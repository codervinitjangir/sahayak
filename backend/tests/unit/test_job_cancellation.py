"""
Unit tests for job_service.cancel_job_by_owner.

The integration harness (tests/integration/check_job_cancellation.py) proves
this works against real Postgres with real tokens. What it cannot do cheaply is
sweep every job status, or assert on writes that never happened — "raised the
right error but committed anyway" is invisible to a status-code check, and it
is the failure mode that matters most on a route whose whole job is to end
something.

So the rules that are pure functions of state are exhausted here: which
statuses are cancellable, which assignment states get closed, and what the
audit trail records. The database is the harness's problem.

One property is deliberately tested twice, in two different ways: that a
cancelled assignment is recorded as 'cancelled' and never 'rejected'. Once as
an outcome, once as a statement about the constant itself. It is the rule most
likely to be "simplified" by a future edit that reuses an existing status, and
it is the one with a consequence nobody would notice — a mechanic's acceptance
rate quietly carrying a customer's decision. See ADR-012.

No database. The repositories are stubbed.
"""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.sql import ClauseElement

from app.repositories import job_repository
from app.schemas.job import JobCancelRequest
from app.services import job_service
from app.services.job_service import TERMINAL_JOB_STATUSES
from app.utils.errors import AppError, ErrorCode

OWNER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER_OWNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
PARTNER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
JOB_ID = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
FIXED_NOW = datetime(2026, 9, 22, 12, 0, 0, tzinfo=timezone.utc)

# Every value the jobs status CHECK constraint allows.
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

# Written out here rather than imported from the service, so the assertion is
# the specification and not a restatement of whatever the code currently says.
# An owner may call off anything that has not finished.
EXPECTED_CANCELLABLE = {
    "requested",
    "matching",
    "assigned",
    "partner_en_route",
    "in_progress",
    "no_match_found",
}


class FakeSession:
    """Just enough AsyncSession for the service's transaction boundary."""

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def refresh(self, obj) -> None:
        """Resolve pending SQL expressions the way a real refresh does.

        cancelled_at is written as func.now() so the timestamp comes off the
        database clock, which leaves a ClauseElement on the in-memory object
        until it is re-read. A no-op refresh here would let that placeholder
        reach the response model and fail validation — a failure that says
        nothing about the service and everything about the double.
        """
        value = getattr(obj, "cancelled_at", None)
        if isinstance(value, ClauseElement):
            obj.cancelled_at = FIXED_NOW


class FakeJob:
    def __init__(self, status: str, user_id: uuid.UUID = OWNER_ID) -> None:
        self.id = JOB_ID
        self.user_id = user_id
        self.status = status
        self.price_final = None
        self.completed_at = None
        self.cancelled_at = None
        self.cancellation_reason = None


class FakeAssignment:
    def __init__(self, status: str = "offered") -> None:
        self.id = uuid.uuid4()
        self.job_id = JOB_ID
        self.partner_id = PARTNER_ID
        self.status = status


@pytest.fixture
def stub_repos(monkeypatch):
    """Point every repository call at an in-memory answer.

    `job_writes` and `history` are the capture points. Asserting on them is how
    a test tells "the service decided to write X" from "the response happened
    to say X" — the distinction that matters when the bug being guarded against
    is a write that silently did not happen.
    """
    state = {
        "job": FakeJob("assigned"),
        "assignments": [],
        "job_writes": None,
        "history": [],
        "locked_read": False,
    }

    async def get_job_by_id_for_update(_db, _job_id):
        state["locked_read"] = True
        return state["job"]

    async def get_job_by_id(_db, _job_id):
        # A tripwire, not a stub. Cancelling reads the job under SELECT ...
        # FOR UPDATE so that the terminal-state check and the write are one
        # atomic decision; swapping back to the non-locking read reopens the
        # cancel-vs-complete lost update, and nothing about the response shape
        # would change to show it. Failing here makes that regression loud
        # across every test in this file instead of silent in production.
        raise AssertionError(
            "cancel_job_by_owner fetched the job through the non-locking "
            "get_job_by_id(); it must use get_job_by_id_for_update(). "
            "See ADR-013."
        )

    async def get_open_assignments(_db, _job_id):
        return state["assignments"]

    async def update_job_fields(_db, job, **fields):
        state["job_writes"] = fields
        for name, value in fields.items():
            setattr(job, name, value)
        return job

    async def set_assignment_status(_db, assignment, status):
        assignment.status = status
        return assignment

    async def create_status_history_row(_db, *, job_id, status, note=None):
        state["history"].append({"job_id": job_id, "status": status, "note": note})
        return None

    repo = job_service.job_repository
    monkeypatch.setattr(repo, "get_job_by_id", get_job_by_id)
    monkeypatch.setattr(repo, "get_job_by_id_for_update", get_job_by_id_for_update)
    monkeypatch.setattr(repo, "get_open_assignments", get_open_assignments)
    monkeypatch.setattr(repo, "update_job_fields", update_job_fields)
    monkeypatch.setattr(repo, "set_assignment_status", set_assignment_status)
    monkeypatch.setattr(repo, "create_status_history_row", create_status_history_row)
    return state


def cancel(session: FakeSession, reason=None, user_id=OWNER_ID):
    """Run the coroutine. asyncio.run() rather than pytest-asyncio, which this
    project does not depend on."""
    payload = JobCancelRequest(cancellation_reason=reason)
    return asyncio.run(
        job_service.cancel_job_by_owner(session, JOB_ID, payload, user_id)
    )


class TestWhichStatusesCanBeCancelled:
    def test_every_status_matches_the_specified_rule(self, stub_repos):
        """All eight statuses, one assertion each.

        The cross-check that would catch a terminal set quietly widened to
        include 'in_progress' — which reads plausible, and would take the
        cancel button away from exactly the driver most likely to need it.
        """
        for source in ALL_JOB_STATUSES:
            stub_repos["job"] = FakeJob(source)
            stub_repos["assignments"] = []
            stub_repos["history"] = []
            session = FakeSession()

            if source in EXPECTED_CANCELLABLE:
                result = cancel(session)
                assert result.status == "cancelled", source
                assert session.committed, f"{source} did not commit"
            else:
                with pytest.raises(AppError) as exc:
                    cancel(session)
                assert exc.value.status_code == 409, source
                assert exc.value.code == ErrorCode.JOB_ALREADY_TERMINAL, source
                assert not session.committed, f"{source} committed"
                assert stub_repos["history"] == [], f"{source} wrote history"

    def test_terminal_set_is_exactly_the_two_finished_states(self):
        assert TERMINAL_JOB_STATUSES == {"completed", "cancelled"}

    def test_no_match_found_is_cancellable(self, stub_repos):
        """The contested one, asserted by name rather than only in the sweep.

        The partner-side table gives 'no_match_found' nowhere to go, so it
        looks terminal. For the owner it is not: nobody ever came, the request
        was never served, and refusing would leave a driver who has given up
        holding a booking they cannot clear.
        """
        stub_repos["job"] = FakeJob("no_match_found")
        session = FakeSession()

        result = cancel(session)

        assert result.status == "cancelled"
        assert session.committed
        assert "no_match_found" not in TERMINAL_JOB_STATUSES

    def test_a_job_nobody_has_been_offered_cancels_cleanly(self, stub_repos):
        """'requested' with no assignment row at all — the case the partner
        endpoint cannot reach, and the likeliest real cancellation."""
        stub_repos["job"] = FakeJob("requested")
        stub_repos["assignments"] = []
        session = FakeSession()

        result = cancel(session)

        assert result.status == "cancelled"
        # Null, not 'cancelled': no partner was released, and saying one was
        # would have the owner's app render a mechanic who never existed.
        assert result.assignment_status is None
        assert session.committed


class TestOnlyTheOwnerMayCancel:
    def test_unknown_job_is_404(self, stub_repos):
        stub_repos["job"] = None
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            cancel(session)
        assert exc.value.status_code == 404
        assert exc.value.code == ErrorCode.JOB_NOT_FOUND

    def test_someone_elses_job_is_403(self, stub_repos):
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            cancel(session, user_id=OTHER_OWNER_ID)
        assert exc.value.status_code == 403
        assert exc.value.code == ErrorCode.FORBIDDEN
        assert not session.committed
        assert stub_repos["history"] == []
        assert stub_repos["job_writes"] is None

    def test_403_wins_over_409_so_state_cannot_be_probed(self, stub_repos):
        """A stranger must not learn a job's status from which error they get.

        With the checks in the other order, anyone holding a user token could
        sweep job ids and read each one's state off the 409/403 pattern. The
        cancel body carries nothing worth guessing, so the error code would be
        the entire oracle.
        """
        stub_repos["job"] = FakeJob("completed", user_id=OWNER_ID)
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            cancel(session, user_id=OTHER_OWNER_ID)
        assert exc.value.status_code == 403

    def test_the_403_message_does_not_name_the_owner_or_the_status(self, stub_repos):
        stub_repos["job"] = FakeJob("in_progress")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            cancel(session, user_id=OTHER_OWNER_ID)
        message = exc.value.message
        assert "in_progress" not in message
        assert str(OWNER_ID) not in message


class TestAlreadyFinished:
    def test_completed_job_is_409_job_already_terminal(self, stub_repos):
        stub_repos["job"] = FakeJob("completed")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            cancel(session)
        assert exc.value.status_code == 409
        assert exc.value.code == ErrorCode.JOB_ALREADY_TERMINAL

    def test_already_cancelled_job_is_409(self, stub_repos):
        """A second tap on the cancel button, which is a thing that happens.

        409 rather than a courteous 200: the second caller's request did not do
        what it asked for, and reporting success would hide a double-submit bug
        in the client that matters elsewhere.
        """
        stub_repos["job"] = FakeJob("cancelled")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            cancel(session)
        assert exc.value.status_code == 409
        assert exc.value.code == ErrorCode.JOB_ALREADY_TERMINAL

    def test_a_refused_cancellation_writes_nothing(self, stub_repos):
        stub_repos["job"] = FakeJob("completed")
        session = FakeSession()
        with pytest.raises(AppError):
            cancel(session, reason="changed my mind")
        assert stub_repos["job_writes"] is None
        assert stub_repos["history"] == []
        assert not session.committed

    def test_the_error_code_is_not_the_partner_endpoints(self, stub_repos):
        """JOB_ALREADY_TERMINAL, not INVALID_STATUS_TRANSITION.

        The partner names a target status, so their failure is "you cannot get
        *there* from here". An owner names no target, so the only thing that
        can be wrong is the job being over — and the client remedies differ:
        one retries with a different status, the other stops showing a cancel
        button.
        """
        stub_repos["job"] = FakeJob("completed")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            cancel(session)
        assert exc.value.code != ErrorCode.INVALID_STATUS_TRANSITION


class TestTheAssignmentIsClosedNotRejected:
    def test_an_outstanding_offer_becomes_cancelled(self, stub_repos):
        """Cancelling from 'matching', with an offer nobody has answered.

        The offer has to be closed even though the partner never accepted:
        left at 'offered' it is a notification sitting on a mechanic's phone
        for a job that no longer exists, with an accept button that still works.
        """
        stub_repos["job"] = FakeJob("matching")
        offered = FakeAssignment("offered")
        stub_repos["assignments"] = [offered]
        session = FakeSession()

        result = cancel(session)

        assert offered.status == "cancelled"
        assert offered.status != "rejected"
        assert result.assignment_status == "cancelled"

    def test_an_accepted_assignment_becomes_cancelled(self, stub_repos):
        stub_repos["job"] = FakeJob("assigned")
        accepted = FakeAssignment("accepted")
        stub_repos["assignments"] = [accepted]
        session = FakeSession()

        result = cancel(session)

        assert accepted.status == "cancelled"
        assert result.assignment_status == "cancelled"
        assert session.committed

    def test_rejected_is_never_written_by_this_path(self, stub_repos):
        """ADR-012, as a property rather than an outcome.

        'rejected' is the partner's answer to an offer and feeds acceptance
        rate. A customer calling off their own booking must never land there:
        it would charge a mechanic for a decision that was not theirs, in a
        metric that may later drive ranking or pay.
        """
        for existing in job_repository.OPEN_ASSIGNMENT_STATUSES:
            stub_repos["job"] = FakeJob("assigned")
            assignment = FakeAssignment(existing)
            stub_repos["assignments"] = [assignment]
            cancel(FakeSession())
            assert assignment.status == "cancelled", existing

    def test_open_means_offered_or_accepted_and_nothing_else(self):
        """The repository's status set is the release rule, so it is asserted
        directly. The closed states must stay out: rewriting a 'rejected' row
        to 'cancelled' would erase a partner's own answer, and rewriting a
        'completed' one would erase the fact that the work was done."""
        open_statuses = set(job_repository.OPEN_ASSIGNMENT_STATUSES)
        assert open_statuses == {"offered", "accepted"}
        assert open_statuses.isdisjoint({"rejected", "timed_out", "completed", "cancelled"})

    def test_every_open_assignment_is_closed_not_just_the_first(self, stub_repos):
        """At most one should ever be open. The loop does not rely on that.

        A stray 'offered' row surviving a cancellation is a live offer against
        a job that no longer exists — the exact thing this endpoint is closing.
        """
        stub_repos["job"] = FakeJob("matching")
        rows = [FakeAssignment("offered"), FakeAssignment("accepted")]
        stub_repos["assignments"] = rows
        session = FakeSession()

        cancel(session)

        assert [row.status for row in rows] == ["cancelled", "cancelled"]


class TestWhatIsRecorded:
    def test_exactly_one_history_row_is_written(self, stub_repos):
        session = FakeSession()
        cancel(session)
        assert len(stub_repos["history"]) == 1
        assert stub_repos["history"][0]["status"] == "cancelled"
        assert stub_repos["history"][0]["job_id"] == JOB_ID

    def test_the_history_note_names_the_owner_as_the_actor(self, stub_repos):
        """job_status_history has no actor column, so a bare 'cancelled' row
        cannot say whether the customer called the job off or the mechanic
        did — the single most useful thing to know about a cancellation. Until
        that column exists the note carries it. See ADR-013."""
        session = FakeSession()
        cancel(session)
        assert stub_repos["history"][0]["note"] == "Cancelled by owner"

    def test_the_note_keeps_the_actor_when_a_reason_is_given(self, stub_repos):
        """The reason must not displace the actor — a note reading only "car
        started" is indistinguishable from the partner's own cancellation."""
        session = FakeSession()
        cancel(session, reason="car started on its own")
        assert stub_repos["history"][0]["note"] == (
            "Cancelled by owner: car started on its own"
        )

    def test_the_reason_is_also_stored_on_the_job(self, stub_repos):
        session = FakeSession()
        result = cancel(session, reason="found a friend with cables")
        assert stub_repos["job_writes"]["cancellation_reason"] == (
            "found a friend with cables"
        )
        assert result.cancellation_reason == "found a friend with cables"

    def test_no_reason_is_allowed_and_stores_null(self, stub_repos):
        """Optional on purpose: a forced reason is a column full of 'x'."""
        session = FakeSession()
        result = cancel(session)
        assert stub_repos["job_writes"]["cancellation_reason"] is None
        assert result.cancellation_reason is None

    def test_cancelled_at_comes_off_the_database_clock(self, stub_repos):
        """func.now(), not a Python datetime: "how long did this job sit before
        being called off" must not depend on which API process answered."""
        session = FakeSession()
        written = None

        result = cancel(session)
        written = stub_repos["job_writes"]["cancelled_at"]

        # The service hands the repository a SQL expression; the value on the
        # response is what came back from the refresh.
        assert result.cancelled_at == FIXED_NOW
        assert written is not None

    def test_the_write_stays_inside_the_lifecycle_allowlist(self, stub_repos):
        """update_job_fields is generic; the service must only hand it
        lifecycle columns. Catches a future edit that reaches for user_id."""
        session = FakeSession()
        cancel(session, reason="x")
        assert set(stub_repos["job_writes"]) == {
            "status",
            "cancelled_at",
            "cancellation_reason",
        }

    def test_no_price_is_ever_written_by_a_cancellation(self, stub_repos):
        """A cancelled job has no final price. Writing one would put a charge
        against work that did not happen."""
        session = FakeSession()
        cancel(session)
        assert "price_final" not in stub_repos["job_writes"]
        assert "completed_at" not in stub_repos["job_writes"]


class TestTheRequestBody:
    def test_status_cannot_be_sent(self):
        """The obvious client guess, if they have only read /status.

        Refused rather than ignored: accepting and dropping it would let a
        client believe they had posted 'completed' and got a 200 for it.
        """
        with pytest.raises(Exception) as exc:
            JobCancelRequest(status="cancelled")
        assert "status" in str(exc.value)

    def test_an_empty_body_is_valid(self):
        assert JobCancelRequest().cancellation_reason is None

    def test_an_overlong_reason_is_refused(self):
        with pytest.raises(Exception):
            JobCancelRequest(cancellation_reason="x" * 501)
