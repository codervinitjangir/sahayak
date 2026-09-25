"""The capacity check and the dispatch-outage record, at unit speed.

Two fixes share this file because they share a shape: both are a single call
added to an existing path, and both are invisible if that call is deleted.
Deleting a call is the cheapest regression there is and the hardest to notice
in review, so each one gets a test that fails loudly when it goes missing.

What these tests are for, and what they cannot do:

They pin the *shape* of both fixes — that _accept() asks _require_capacity()
before it writes anything, that _require_capacity() reaches the partner through
the locking read rather than a plain one, that it counts only after that read
has returned, that a refusal leaves the offer 'offered' and re-dispatches
exactly once, and that job_service._try_dispatch() distinguishes
DispatchUnavailableError from every other failure while still never failing the
POST. They also pin the two wire facts a client depends on: 409 for
PARTNER_AT_CAPACITY, and an unchanged 500 INTERNAL_ERROR for the new exception
type.

They cannot prove the race is closed. Nothing running in one process against a
fake session can — two concurrent transactions and a real Postgres row lock are
required, which is tests/integration/check_dispatch_capacity.py's job. The
division is the same one test_dispatch_locking.py draws, and for the same
reason: these run on every change and catch the fix being *removed*; the
harness proves the fix *works* and is run deliberately.

pytest-asyncio is not installed; async services are driven with asyncio.run()
inside sync tests, as elsewhere in this suite.
"""
import asyncio
import uuid

import pytest

from app.repositories import dispatch_repository, job_repository
from app.services import dispatch_service, job_service
from app.services.dispatch_service import (
    DISPATCH_UNAVAILABLE_NOTE,
    STATUS_MATCHING,
    STATUS_NO_MATCH_FOUND,
    STATUS_REQUESTED,
)
from app.utils.errors import (
    AppError,
    DispatchUnavailableError,
    ErrorCode,
    InternalError,
)

CAP = dispatch_repository.MAX_CONCURRENT_JOBS


class FakeJob:
    def __init__(self, status: str = STATUS_MATCHING) -> None:
        self.id = uuid.uuid4()
        self.status = status
        self.user_id = uuid.uuid4()


class FakePartner:
    def __init__(self, partner_id: uuid.UUID) -> None:
        self.id = partner_id


class FakeAssignment:
    def __init__(self, job_id: uuid.UUID, partner_id: uuid.UUID, rank: int = 1) -> None:
        self.id = uuid.uuid4()
        self.job_id = job_id
        self.partner_id = partner_id
        self.status = "offered"
        self.assignment_rank = rank
        self.responded_at = None


class FakeSession:
    """Just enough AsyncSession to observe the transaction boundary."""

    def __init__(self) -> None:
        self.commits = 0
        self.rolled_back = False

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rolled_back = True

    async def refresh(self, _obj) -> None:
        return None


def wire_capacity(
    monkeypatch,
    *,
    job: FakeJob,
    assignment: FakeAssignment,
    active: int,
    latest_rank: int | None = None,
    partner_missing: bool = False,
) -> dict:
    """Patch everything _require_capacity and _accept can reach.

    `active` is what the count returns. `latest_rank` defaults to the
    assignment's own rank, i.e. this offer is the newest one on the job.

    Returns an event log, so a test can assert on *order* — which is most of
    what matters here — rather than only on the outcome.
    """
    state: dict = {"events": [], "counted_after_lock": None}
    rank_ceiling = assignment.assignment_rank if latest_rank is None else latest_rank

    async def lock_partner_for_update(_db, partner_id):
        state["events"].append("lock_partner")
        state["locked_partner_id"] = partner_id
        return None if partner_missing else FakePartner(partner_id)

    async def count_active_jobs(_db, _partner_id):
        state["events"].append("count")
        state["counted_after_lock"] = "lock_partner" in state["events"]
        return active

    async def get_partner_by_id(_db, _partner_id):
        # A tripwire, not a stub. The plain read cannot order two concurrent
        # accepts by the same partner, so a count taken after it is a count of
        # a number that may already be stale. See the ADR-009 amendment.
        raise AssertionError(
            "_require_capacity read the partner through the non-locking "
            "get_partner_by_id(); it must use lock_partner_for_update(), or "
            "two accepts for two different jobs will both pass the check. "
            "See ADR-009 and ADR-015."
        )

    async def get_max_assignment_rank(_db, _job_id):
        state["events"].append("max_rank")
        return rank_ceiling

    async def _offer_next(_db, _job):
        state["events"].append("offer_next")
        return FakeAssignment(job.id, uuid.uuid4(), rank_ceiling + 1)

    async def mark_assignment_accepted(_db, a):
        state["events"].append("assignment_accepted")
        a.status = "accepted"

    async def mark_assignment_rejected(_db, a, _reason):
        state["events"].append("assignment_rejected")
        a.status = "rejected"

    async def set_job_status(_db, j, status):
        state["events"].append(f"job_status:{status}")
        j.status = status

    async def create_status_history_row(_db, *, job_id, status, note):
        state["events"].append(f"history:{status}")
        state.setdefault("notes", []).append(note)

    monkeypatch.setattr(dispatch_repository, "lock_partner_for_update", lock_partner_for_update)
    monkeypatch.setattr(dispatch_repository, "count_active_jobs", count_active_jobs)
    monkeypatch.setattr(dispatch_repository, "get_max_assignment_rank", get_max_assignment_rank)
    monkeypatch.setattr(dispatch_repository, "mark_assignment_accepted", mark_assignment_accepted)
    monkeypatch.setattr(dispatch_repository, "mark_assignment_rejected", mark_assignment_rejected)
    monkeypatch.setattr(dispatch_repository, "set_job_status", set_job_status)
    monkeypatch.setattr(job_repository, "create_status_history_row", create_status_history_row)
    monkeypatch.setattr(dispatch_service, "_offer_next", _offer_next)
    if hasattr(dispatch_repository, "get_partner_by_id"):
        monkeypatch.setattr(dispatch_repository, "get_partner_by_id", get_partner_by_id)
    return state


def accept(db, assignment, job):
    return asyncio.run(dispatch_service._accept(db, assignment, job, 0.0))


class TestTheCapIsRecheckedAtAccept:
    """Bug 1. The filter at dispatch was the only enforcement; now it is not."""

    def test_an_accept_at_the_cap_is_refused_with_409_partner_at_capacity(self, monkeypatch):
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        wire_capacity(monkeypatch, job=job, assignment=a, active=CAP)

        with pytest.raises(AppError) as exc_info:
            accept(FakeSession(), a, job)

        assert exc_info.value.status_code == 409
        assert exc_info.value.code == ErrorCode.PARTNER_AT_CAPACITY

    def test_an_accept_below_the_cap_goes_through_untouched(self, monkeypatch):
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        state = wire_capacity(monkeypatch, job=job, assignment=a, active=CAP - 1)

        accept(FakeSession(), a, job)

        assert a.status == "accepted"
        assert job.status == "assigned"
        assert "offer_next" not in state["events"]

    def test_a_partner_already_over_the_cap_is_refused_too(self, monkeypatch):
        """Defensive, and not hypothetical.

        The load test found partners holding four active jobs against a cap of
        two, so rows in that state exist in any database that ran the old code.
        A check written as `== CAP` rather than `>= CAP` would wave every one of
        them straight through.
        """
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        wire_capacity(monkeypatch, job=job, assignment=a, active=CAP + 2)

        with pytest.raises(AppError) as exc_info:
            accept(FakeSession(), a, job)

        assert exc_info.value.code == ErrorCode.PARTNER_AT_CAPACITY

    def test_the_check_runs_before_anything_is_written(self, monkeypatch):
        """Ordering. A check that ran after the write would be an audit, not a cap."""
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        state = wire_capacity(monkeypatch, job=job, assignment=a, active=CAP)

        with pytest.raises(AppError):
            accept(FakeSession(), a, job)

        assert "assignment_accepted" not in state["events"]
        assert f"job_status:assigned" not in state["events"]
        assert a.status == "offered"
        assert job.status == STATUS_MATCHING

    def test_the_partner_row_is_locked_and_counted_in_that_order(self, monkeypatch):
        """The whole fix, in one assertion.

        Counting without the lock is the version that looks correct, passes
        every sequential test, and still lets two accepts for two different jobs
        both see the same pre-accept number. The lock has to come first and the
        count has to come after it.
        """
        job = FakeJob()
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id)
        state = wire_capacity(monkeypatch, job=job, assignment=a, active=CAP - 1)

        accept(FakeSession(), a, job)

        assert state["events"][:2] == ["lock_partner", "count"]
        assert state["counted_after_lock"] is True
        assert state["locked_partner_id"] == partner_id

    def test_a_missing_partner_row_degrades_instead_of_failing(self, monkeypatch):
        """partner_id is a foreign key, so this needs the row deleted under a live
        offer. If it somehow happens, the partner standing there holding their
        phone should get the job, not a 404 about themselves."""
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        wire_capacity(
            monkeypatch, job=job, assignment=a, active=0, partner_missing=True
        )

        accept(FakeSession(), a, job)

        assert a.status == "accepted"


class TestWhatARefusalDoesToTheOffer:
    def test_the_offer_stays_offered_and_is_never_marked_rejected(self, monkeypatch):
        """Being full is not declining.

        Writing 'rejected' would charge a mechanic's acceptance rate for a limit
        the platform imposed on them — the reasoning ADR-012 already applied to
        owner cancellation.
        """
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        state = wire_capacity(monkeypatch, job=job, assignment=a, active=CAP)

        with pytest.raises(AppError):
            accept(FakeSession(), a, job)

        assert a.status == "offered"
        assert "assignment_rejected" not in state["events"]

    def test_the_job_is_re_dispatched_to_the_next_candidate(self, monkeypatch):
        """From the driver's side a refusal must look like a decline, not an error."""
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        state = wire_capacity(monkeypatch, job=job, assignment=a, active=CAP)

        with pytest.raises(AppError):
            accept(FakeSession(), a, job)

        assert state["events"].count("offer_next") == 1
        assert job.status == STATUS_MATCHING

    def test_the_locks_are_released_before_the_re_dispatch(self, monkeypatch):
        """_offer_next() reaches Redis. Holding the job and partner row locks
        across a call to another service is the one thing this module refuses to
        do anywhere, so the (write-free) commit has to land first."""
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        db = FakeSession()

        commits_at_offer = {}
        original = dispatch_service._offer_next
        state = wire_capacity(monkeypatch, job=job, assignment=a, active=CAP)
        patched_offer_next = dispatch_service._offer_next

        async def recording_offer_next(_db, _job):
            commits_at_offer["value"] = db.commits
            return await patched_offer_next(_db, _job)

        monkeypatch.setattr(dispatch_service, "_offer_next", recording_offer_next)

        with pytest.raises(AppError):
            accept(db, a, job)

        assert commits_at_offer["value"] >= 1, (
            "_offer_next ran while the job and partner row locks were still held"
        )
        assert original is not None

    def test_a_stale_offer_does_not_re_dispatch_again(self, monkeypatch):
        """The rank guard.

        Because the refused offer survives, the partner's app keeps showing it
        and it will be tapped again. Unguarded, every tap burns another
        candidate, and the job eventually reaches 'no_match_found' while several
        partners are still holding live offers for it.
        """
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4(), rank=1)
        state = wire_capacity(
            monkeypatch, job=job, assignment=a, active=CAP, latest_rank=3
        )

        with pytest.raises(AppError) as exc_info:
            accept(FakeSession(), a, job)

        assert exc_info.value.code == ErrorCode.PARTNER_AT_CAPACITY
        assert "offer_next" not in state["events"], (
            "a refusal on an already-superseded offer created yet another offer"
        )

    def test_the_newest_offer_still_re_dispatches(self, monkeypatch):
        """The other half of the guard: it must not suppress the real case."""
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4(), rank=3)
        state = wire_capacity(
            monkeypatch, job=job, assignment=a, active=CAP, latest_rank=3
        )

        with pytest.raises(AppError):
            accept(FakeSession(), a, job)

        assert state["events"].count("offer_next") == 1


class TestTheWireContractOfARefusal:
    def test_partner_at_capacity_is_its_own_code(self):
        """Not folded into ASSIGNMENT_ALREADY_ANSWERED, because the remedies
        differ: that one means the offer is gone, this one means *you are full*
        and the same offer may be acceptable in ten minutes."""
        assert ErrorCode.PARTNER_AT_CAPACITY == "PARTNER_AT_CAPACITY"
        assert ErrorCode.PARTNER_AT_CAPACITY != ErrorCode.ASSIGNMENT_ALREADY_ANSWERED

    def test_the_message_tells_the_partner_the_job_moved_on(self, monkeypatch):
        """A 409 that only said "no" would read as a bug in the app. The partner
        needs to know the customer is being looked after by someone else."""
        job = FakeJob()
        a = FakeAssignment(job.id, uuid.uuid4())
        wire_capacity(monkeypatch, job=job, assignment=a, active=CAP)

        with pytest.raises(AppError) as exc_info:
            accept(FakeSession(), a, job)

        message = exc_info.value.message.lower()
        assert str(CAP) in exc_info.value.message
        assert "another partner" in message


# --------------------------------------------------------------------------
# Bug 2 — the outage that used to be invisible.
# --------------------------------------------------------------------------
class FakeCreatedJob:
    def __init__(self) -> None:
        self.id = uuid.uuid4()
        self.status = STATUS_REQUESTED


def wire_dispatch(monkeypatch, *, raises: Exception | None, record=None) -> dict:
    state: dict = {"dispatched": 0, "recorded": 0}

    async def dispatch_job(_db, _job_id):
        state["dispatched"] += 1
        if raises is not None:
            raise raises

    async def mark_dispatch_unavailable(_db, job_id):
        state["recorded"] += 1
        state["recorded_job_id"] = job_id
        if record is not None:
            raise record
        return True

    monkeypatch.setattr(dispatch_service, "dispatch_job", dispatch_job)
    monkeypatch.setattr(
        dispatch_service, "mark_dispatch_unavailable", mark_dispatch_unavailable
    )
    return state


def try_dispatch(job) -> None:
    asyncio.run(job_service._try_dispatch(FakeSession(), job))


class TestADeadLocationStoreIsRecorded:
    def test_a_dispatch_unavailable_error_is_recorded(self, monkeypatch):
        job = FakeCreatedJob()
        state = wire_dispatch(
            monkeypatch, raises=DispatchUnavailableError("location store is down")
        )

        try_dispatch(job)

        assert state["recorded"] == 1
        assert state["recorded_job_id"] == job.id

    def test_any_other_failure_leaves_the_job_in_requested(self, monkeypatch):
        """The distinction is the whole point.

        'requested' is the honest state for most faults — nobody has been asked
        yet, and something may yet ask. It is only wrong for the fault where
        nothing will ever look again.
        """
        job = FakeCreatedJob()
        state = wire_dispatch(monkeypatch, raises=RuntimeError("a database write failed"))

        try_dispatch(job)

        assert state["recorded"] == 0
        assert job.status == STATUS_REQUESTED

    def test_a_successful_dispatch_records_nothing(self, monkeypatch):
        job = FakeCreatedJob()
        state = wire_dispatch(monkeypatch, raises=None)

        try_dispatch(job)

        assert state["dispatched"] == 1
        assert state["recorded"] == 0

    def test_a_failure_while_recording_still_does_not_fail_the_post(self, monkeypatch):
        """Recovery from a failure must not become a second failure.

        Worst case the job stays in 'requested', which is where it was a moment
        earlier — strictly no worse than before this fix existed.
        """
        job = FakeCreatedJob()
        wire_dispatch(
            monkeypatch,
            raises=DispatchUnavailableError("location store is down"),
            record=RuntimeError("and the recovery write failed too"),
        )

        try_dispatch(job)   # must not raise

    def test_nothing_is_retried_inside_the_request(self, monkeypatch):
        """A retry here would block the driver's POST on a dependency that has
        just timed out — paying the timeout twice to create the same job."""
        job = FakeCreatedJob()
        state = wire_dispatch(
            monkeypatch, raises=DispatchUnavailableError("location store is down")
        )

        try_dispatch(job)

        assert state["dispatched"] == 1


class TestTheOutageStaysDistinguishable:
    def test_dispatch_unavailable_error_is_an_internal_error(self):
        """A new *type*, deliberately not a new *response*. The client's remedy
        does not change, so neither does the wire contract."""
        exc = DispatchUnavailableError("location store is down")
        assert isinstance(exc, InternalError)
        assert exc.status_code == 500
        assert exc.code == ErrorCode.INTERNAL_ERROR

    def test_the_note_is_a_constant_the_evaluation_query_can_match(self):
        """ADR-016 routes a dispatch outage to the same status as "nobody
        available" and keeps the cause in the note. That only works if the note
        is stable and prefix-matchable — the reporting query is
        `note LIKE 'Dispatch unavailable:%'`."""
        assert DISPATCH_UNAVAILABLE_NOTE.startswith("Dispatch unavailable:")

    def test_the_shared_status_is_not_terminal_for_the_owner(self):
        """The reason reusing 'no_match_found' is acceptable at all.

        ADR-013 kept it out of TERMINAL_JOB_STATUSES so an owner can still
        cancel and re-request. If it were terminal, routing an infrastructure
        outage there would strand the driver in a different way.
        """
        assert STATUS_NO_MATCH_FOUND not in job_service.TERMINAL_JOB_STATUSES
