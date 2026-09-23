"""
Unit tests for job_service.transition_job_status.

The integration harness (tests/integration/check_job_lifecycle.py) proves the
endpoint works end to end against real Postgres, but it can only walk a handful
of paths through the transition table before it is doing combinatorics over the
network. The table is a pure function of two strings, so it is tested here
exhaustively — all 8 × 4 source/target pairs — and the harness is left to prove
the parts that involve a database.

The rest of what is covered here is ordering and side effects: that a
non-participant is refused before the legality check leaks anything, that a
refused transition writes nothing, and that a completion closes the assignment
as well as the job. "Raised the right error but committed anyway" is exactly
the bug a status-code-only test cannot see.

No database. The repositories are stubbed; the SQL they contain is the
harness's job.
"""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.sql import ClauseElement

from app.services import job_service
from app.services.job_service import ALLOWED_TRANSITIONS
from app.repositories import job_repository
from app.utils.errors import AppError, ErrorCode

PARTNER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
OTHER_PARTNER_ID = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
JOB_ID = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
# What the stand-in session puts where the database would put now().
FIXED_NOW = datetime(2026, 9, 20, 12, 0, 0, tzinfo=timezone.utc)

# Every status the jobs CHECK constraint allows, and every status a partner is
# allowed to ask for. The exhaustive test is the cross product.
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
REQUESTABLE = ("partner_en_route", "in_progress", "completed", "cancelled")

# What the job's assignment reads once the job itself is terminal. Used to build
# realistic fixtures: a completed job never has an 'accepted' assignment sitting
# under it, because the same transaction that completed it closed the assignment
# out. Testing terminal sources against an 'accepted' assignment would be
# testing a state the database cannot hold.
ASSIGNMENT_FOR_JOB_STATUS = {"completed": "completed", "cancelled": "cancelled"}

# The table this endpoint exists to enforce, written out independently of the
# implementation. Copying ALLOWED_TRANSITIONS into the assertion would make the
# test agree with whatever the code says, including a typo.
EXPECTED_LEGAL = {
    ("assigned", "partner_en_route"),
    ("assigned", "cancelled"),
    ("partner_en_route", "in_progress"),
    ("partner_en_route", "cancelled"),
    ("in_progress", "completed"),
    ("in_progress", "cancelled"),
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

        The service writes completed_at and cancelled_at as func.now() so the
        timestamps come off the database clock, which leaves a ClauseElement on
        the in-memory object until it is re-read. A no-op refresh here would let
        that placeholder reach the response model and fail validation — a
        failure that says nothing about the service and everything about the
        double. Substituting a datetime is what Postgres does.
        """
        for name in ("completed_at", "cancelled_at"):
            value = getattr(obj, name, None)
            if isinstance(value, ClauseElement):
                setattr(obj, name, FIXED_NOW)


class FakeJob:
    def __init__(self, status: str) -> None:
        self.id = JOB_ID
        self.status = status
        self.price_final = None
        self.completed_at = None
        self.cancelled_at = None
        self.cancellation_reason = None


class FakeAssignment:
    def __init__(self, partner_id: uuid.UUID, status: str = "accepted") -> None:
        self.id = uuid.uuid4()
        self.job_id = JOB_ID
        self.partner_id = partner_id
        self.status = status


class Payload:
    """Stands in for JobStatusTransitionRequest — the service reads attributes."""

    def __init__(self, status: str, price_final=None, cancellation_reason=None) -> None:
        self.status = status
        self.price_final = price_final
        self.cancellation_reason = cancellation_reason


@pytest.fixture
def stub_repos(monkeypatch):
    """Point every repository call at an in-memory answer.

    `history` and `job_writes` are the capture points. Asserting on them is how
    a test can tell "the service decided to write X" from "the response happened
    to say X", which is the distinction that matters when the bug being guarded
    against is a write that silently did not happen.
    """
    state = {
        "job": FakeJob("assigned"),
        "assignment": FakeAssignment(PARTNER_ID),
        "job_writes": None,
        "history": [],
        "locked_read": False,
    }

    async def get_job_by_id_for_update(_db, _job_id):
        state["locked_read"] = True
        return state["job"]

    async def get_job_by_id(_db, _job_id):
        # A tripwire, not a stub. The lifecycle endpoint reads the job under
        # SELECT ... FOR UPDATE so that the ALLOWED_TRANSITIONS check and the
        # write are one atomic decision; swapping back to the non-locking read
        # reopens the complete-vs-cancel lost update, and no assertion about
        # the response would notice. Failing here makes that regression loud
        # across every test in this file instead of silent in production.
        raise AssertionError(
            "transition_job_status fetched the job through the non-locking "
            "get_job_by_id(); it must use get_job_by_id_for_update(). "
            "See ADR-013."
        )

    async def get_responsible_assignment(_db, _job_id):
        return state["assignment"]

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
    monkeypatch.setattr(repo, "get_responsible_assignment", get_responsible_assignment)
    monkeypatch.setattr(repo, "update_job_fields", update_job_fields)
    monkeypatch.setattr(repo, "set_assignment_status", set_assignment_status)
    monkeypatch.setattr(repo, "create_status_history_row", create_status_history_row)
    return state


def transition(payload: Payload, session: FakeSession, partner_id=PARTNER_ID):
    """Run the coroutine. asyncio.run() rather than pytest-asyncio, which this
    project does not depend on."""
    return asyncio.run(
        job_service.transition_job_status(session, JOB_ID, payload, partner_id)
    )


class TestTransitionTable:
    """The legal moves, checked as data rather than by walking the happy path."""

    def test_every_pair_matches_the_specified_table(self, stub_repos):
        """All 32 source/target combinations, one assertion each.

        This is the test that would have caught a table permitting
        'completed' → 'cancelled', which reads harmless and would let a
        finished job's price be orphaned behind a cancellation.
        """
        for source in ALL_JOB_STATUSES:
            for target in REQUESTABLE:
                stub_repos["job"] = FakeJob(source)
                stub_repos["assignment"] = FakeAssignment(
                    PARTNER_ID,
                    status=ASSIGNMENT_FOR_JOB_STATUS.get(source, "accepted"),
                )
                session = FakeSession()
                payload = Payload(
                    target,
                    price_final=250 if target == "completed" else None,
                )
                legal = (source, target) in EXPECTED_LEGAL

                if legal:
                    result = transition(payload, session)
                    assert result.status == target, f"{source} -> {target}"
                    assert session.committed, f"{source} -> {target} did not commit"
                else:
                    with pytest.raises(AppError) as exc:
                        transition(payload, session)
                    assert exc.value.status_code == 409, f"{source} -> {target}"
                    assert exc.value.code == ErrorCode.INVALID_STATUS_TRANSITION
                    assert not session.committed, f"{source} -> {target} committed"

    def test_terminal_states_reach_nothing(self):
        """Read off the table directly — the property, not a sampling of it."""
        assert ALLOWED_TRANSITIONS["completed"] == frozenset()
        assert ALLOWED_TRANSITIONS["cancelled"] == frozenset()

    def test_cancellation_is_reachable_from_every_active_state(self):
        for source in ("assigned", "partner_en_route", "in_progress"):
            assert "cancelled" in ALLOWED_TRANSITIONS[source]

    def test_server_owned_statuses_are_never_a_target(self):
        """Dispatch owns these. A partner reaching one would rewind a job."""
        reachable = set().union(*ALLOWED_TRANSITIONS.values())
        assert reachable.isdisjoint({"requested", "matching", "assigned", "no_match_found"})


class TestCallerMustBeTheAssignedPartner:
    def test_unknown_job_is_404(self, stub_repos):
        stub_repos["job"] = None
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(Payload("partner_en_route"), session)
        assert exc.value.status_code == 404
        assert exc.value.code == ErrorCode.JOB_NOT_FOUND

    def test_different_partner_is_403(self, stub_repos):
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(Payload("partner_en_route"), session, partner_id=OTHER_PARTNER_ID)
        assert exc.value.status_code == 403
        assert exc.value.code == ErrorCode.FORBIDDEN
        assert not session.committed
        assert stub_repos["history"] == []

    def test_job_with_no_accepted_assignment_is_403(self, stub_repos):
        """A job still out on offer has nobody entitled to move it."""
        stub_repos["assignment"] = None
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(Payload("partner_en_route"), session)
        assert exc.value.status_code == 403

    def test_403_wins_over_409_so_state_cannot_be_probed(self, stub_repos):
        """A stranger must not learn a job's status from which error they get.

        With the checks in the other order, a non-participant could sweep the
        four requestable statuses against a job id and read its current state
        off the 409/403 pattern.
        """
        stub_repos["job"] = FakeJob("completed")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(Payload("cancelled"), session, partner_id=OTHER_PARTNER_ID)
        assert exc.value.status_code == 403

    def test_the_partner_who_finished_the_job_still_owns_it(self, stub_repos):
        """...but the partner who *did* the job is owed the truthful answer.

        Caught by the integration harness, not by this module: completing a job
        closes its assignment out of 'accepted', so a lookup keyed on
        'accepted' alone made the job's own partner a stranger to it one
        transaction later. Every terminal-state check came back 403 ("you are
        not assigned to this job") instead of 409 ("this job is finished") —
        which is both the wrong code and a false statement. The probing
        defence above is unaffected: the intruder is refused by partner_id.
        """
        stub_repos["job"] = FakeJob("completed")
        stub_repos["assignment"] = FakeAssignment(PARTNER_ID, status="completed")
        session = FakeSession()

        with pytest.raises(AppError) as exc:
            transition(Payload("in_progress"), session)

        assert exc.value.status_code == 409
        assert exc.value.code == ErrorCode.INVALID_STATUS_TRANSITION

    def test_a_cancelled_job_answers_its_partner_the_same_way(self, stub_repos):
        stub_repos["job"] = FakeJob("cancelled")
        stub_repos["assignment"] = FakeAssignment(PARTNER_ID, status="cancelled")
        session = FakeSession()

        with pytest.raises(AppError) as exc:
            transition(Payload("completed", price_final=250), session)

        assert exc.value.status_code == 409

    def test_being_merely_offered_the_job_confers_nothing(self):
        """The repository's status set is the authorisation rule, so it is
        asserted directly. 'offered', 'rejected' and 'timed_out' all mean the
        partner was asked and nothing more — none of them may let someone move
        a job somebody else is doing."""
        responsible = set(job_repository.RESPONSIBLE_ASSIGNMENT_STATUSES)
        assert responsible == {"accepted", "completed", "cancelled"}
        assert responsible.isdisjoint({"offered", "rejected", "timed_out"})


class TestConditionalBodyFields:
    def test_completion_without_price_is_400(self, stub_repos):
        stub_repos["job"] = FakeJob("in_progress")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(Payload("completed"), session)
        assert exc.value.status_code == 400
        assert exc.value.code == ErrorCode.PRICE_FINAL_REQUIRED
        assert not session.committed
        assert stub_repos["history"] == []

    def test_price_on_a_non_completion_is_400(self, stub_repos):
        """Refused, not ignored: the client has the wrong state in mind, and
        accepting the request would tell them the price was recorded."""
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(Payload("partner_en_route", price_final=250), session)
        assert exc.value.status_code == 400
        assert exc.value.code == ErrorCode.FIELD_NOT_APPLICABLE

    def test_cancellation_reason_outside_a_cancellation_is_400(self, stub_repos):
        stub_repos["job"] = FakeJob("in_progress")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(
                Payload("completed", price_final=250, cancellation_reason="oops"),
                session,
            )
        assert exc.value.status_code == 400
        assert exc.value.code == ErrorCode.FIELD_NOT_APPLICABLE

    def test_cancellation_without_a_reason_is_allowed(self, stub_repos):
        """Optional on purpose: a forced reason is a column full of 'x'."""
        session = FakeSession()
        result = transition(Payload("cancelled"), session)
        assert result.status == "cancelled"
        assert session.committed

    def test_409_is_raised_before_400(self, stub_repos):
        """A finished job is told it is finished, not told to add a price.

        Otherwise a client completing an already-completed job gets
        PRICE_FINAL_REQUIRED, adds the price, and gets a 409 on the retry — two
        round trips to learn one fact.
        """
        stub_repos["job"] = FakeJob("completed")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            transition(Payload("completed"), session)
        assert exc.value.status_code == 409


class TestSideEffects:
    def test_completion_writes_price_timestamp_and_closes_the_assignment(self, stub_repos):
        stub_repos["job"] = FakeJob("in_progress")
        session = FakeSession()
        result = transition(Payload("completed", price_final=1250), session)

        writes = stub_repos["job_writes"]
        assert writes["status"] == "completed"
        assert writes["price_final"] == 1250
        assert "completed_at" in writes
        # The half the caller cannot otherwise see, and the half that releases
        # the partner from the job.
        assert stub_repos["assignment"].status == "completed"
        assert result.assignment_status == "completed"
        assert session.committed

    def test_cancellation_closes_the_assignment_as_cancelled_not_rejected(self, stub_repos):
        """ADR-012: 'rejected' feeds acceptance rate and belongs to the partner's
        answer to an offer. A customer cancelling must not land on their record."""
        session = FakeSession()
        transition(Payload("cancelled", cancellation_reason="car started"), session)

        assert stub_repos["assignment"].status == "cancelled"
        assert stub_repos["job_writes"]["cancellation_reason"] == "car started"
        assert "cancelled_at" in stub_repos["job_writes"]

    def test_intermediate_moves_leave_the_assignment_accepted(self, stub_repos):
        """The partner is still on the job, so they should still carry its load."""
        session = FakeSession()
        transition(Payload("partner_en_route"), session)
        assert stub_repos["assignment"].status == "accepted"

    def test_every_transition_writes_exactly_one_history_row(self, stub_repos):
        for source, target in sorted(EXPECTED_LEGAL):
            stub_repos["job"] = FakeJob(source)
            stub_repos["assignment"] = FakeAssignment(PARTNER_ID)
            stub_repos["history"] = []
            transition(
                Payload(target, price_final=250 if target == "completed" else None),
                FakeSession(),
            )
            assert len(stub_repos["history"]) == 1, f"{source} -> {target}"
            assert stub_repos["history"][0]["status"] == target

    def test_no_status_change_escapes_the_price_allowlist(self, stub_repos):
        """update_job_fields is generic; the service must only hand it lifecycle
        columns. Catches a future edit that reaches for user_id or vehicle_id."""
        session = FakeSession()
        transition(Payload("partner_en_route"), session)
        assert set(stub_repos["job_writes"]) <= {
            "status",
            "price_final",
            "completed_at",
            "cancelled_at",
            "cancellation_reason",
        }
