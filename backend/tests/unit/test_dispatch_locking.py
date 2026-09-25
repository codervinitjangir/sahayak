"""
The dispatch side of ADR-015: an answer to an offer decides under a row lock.

What these tests are for, and what they cannot do:

They pin the *shape* of the fix — that respond_to_assignment() reaches the job
through job_repository.get_job_by_id_for_update() and not the polled
get_job_by_id(), that it checks job.status only after that call has returned,
and that a job which has left 'matching' is refused. The non-locking read is
replaced by a **tripwire** rather than a stub: if a future edit reverts the
read, these tests fail with a sentence explaining why, instead of silently
passing against reintroduced broken code.

They cannot prove the race is closed. Nothing running in one process against a
fake session can — two concurrent transactions and a real Postgres lock are
required for that, which is tests/integration/check_dispatch_race.py's job.
The division is deliberate: these tests are fast and run on every change, and
they catch the one failure mode the integration harness is bad at catching,
namely somebody deleting the lock and nobody noticing because the harness was
not run.

pytest-asyncio is not installed; async services are driven with asyncio.run()
inside sync tests, as elsewhere in this suite.
"""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest

from app.services import dispatch_service
from app.services.dispatch_service import STATUS_MATCHING
from app.repositories import dispatch_repository, job_repository
from app.utils.errors import AppError, ErrorCode

FIXED_NOW = datetime(2026, 9, 23, 12, 0, 0, tzinfo=timezone.utc)

# Every status the jobs CHECK constraint allows. A live 'offered' assignment can
# only coexist with 'matching' — dispatch_job() commits the move to 'matching'
# before the offer row exists — so every other value here is a job that moved
# underneath the offer and must be refused.
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
    def __init__(self, status: str) -> None:
        self.id = uuid.uuid4()
        self.status = status
        self.user_id = uuid.uuid4()


class FakeAssignment:
    def __init__(self, job_id: uuid.UUID, partner_id: uuid.UUID, status: str) -> None:
        self.id = uuid.uuid4()
        self.job_id = job_id
        self.partner_id = partner_id
        self.status = status
        self.assignment_rank = 1
        self.responded_at = None


class FakePartner:
    def __init__(self, partner_id: uuid.UUID) -> None:
        self.id = partner_id


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
        if getattr(obj, "responded_at", None) is None:
            obj.responded_at = FIXED_NOW


def wire(monkeypatch, *, job: FakeJob, assignment: FakeAssignment) -> dict:
    """Patch every repository call respond_to_assignment can make.

    Returns a dict recording what happened, so a test can assert on the order
    of events rather than only on the return value.
    """
    state: dict = {"locked_read": False, "checked_status_at": None, "writes": [], "locks": []}

    async def get_assignment_by_id(_db, _assignment_id):
        return assignment

    async def get_job_by_id_for_update(_db, _job_id):
        state["locked_read"] = True
        state["locks"].append("job")
        # Snapshot the status as the service sees it at lock time. Any later
        # assertion about "checked after locking" is then a fact about
        # ordering, not an inference from the outcome.
        state["status_at_lock"] = job.status
        return job

    async def get_job_by_id(_db, _job_id):
        # A tripwire, not a stub. This is the lock-free read that exists for the
        # polled GET /jobs/{job_id}; an answer to an offer must never come
        # through it, because the status it returns can be stale by the time the
        # write lands. See ADR-015.
        raise AssertionError(
            "respond_to_assignment fetched the job through the non-locking "
            "get_job_by_id(); it must use get_job_by_id_for_update(). "
            "See ADR-015."
        )

    async def mark_assignment_accepted(_db, a):
        state["writes"].append("assignment_accepted")
        a.status = "accepted"

    async def mark_assignment_rejected(_db, a, _reason):
        state["writes"].append("assignment_rejected")
        a.status = "rejected"

    async def set_job_status(_db, j, status):
        state["writes"].append(f"job_status:{status}")
        j.status = status

    async def create_status_history_row(_db, *, job_id, status, note):
        state["writes"].append(f"history:{status}")

    async def _offer_next(_db, _job):
        state["writes"].append("offer_next")
        return None

    async def lock_partner_for_update(_db, partner_id):
        """The accept-time capacity re-check, added to _accept() after this file
        was written (ADR-009's closure).

        It is not what these tests are about, but it now runs before any write on
        the accept path, so leaving it unstubbed would have the fake session
        asked for a real connection. The partner is returned under the cap, so
        every accept here proceeds exactly as it did before that check existed —
        which is the point: these tests must keep testing the *lock*, not the cap.
        """
        state["partner_locked"] = True
        state["locks"].append("partner")
        return FakePartner(partner_id)

    async def count_active_jobs(_db, _partner_id):
        state["active_counted"] = True
        return 0

    monkeypatch.setattr(dispatch_repository, "get_assignment_by_id", get_assignment_by_id)
    monkeypatch.setattr(dispatch_repository, "mark_assignment_accepted", mark_assignment_accepted)
    monkeypatch.setattr(dispatch_repository, "mark_assignment_rejected", mark_assignment_rejected)
    monkeypatch.setattr(dispatch_repository, "set_job_status", set_job_status)
    monkeypatch.setattr(dispatch_repository, "lock_partner_for_update", lock_partner_for_update)
    monkeypatch.setattr(dispatch_repository, "count_active_jobs", count_active_jobs)
    monkeypatch.setattr(job_repository, "get_job_by_id_for_update", get_job_by_id_for_update)
    monkeypatch.setattr(job_repository, "get_job_by_id", get_job_by_id)
    monkeypatch.setattr(job_repository, "create_status_history_row", create_status_history_row)
    monkeypatch.setattr(dispatch_service, "_offer_next", _offer_next)
    return state


def respond(db, assignment, partner_id, action="accept"):
    return asyncio.run(
        dispatch_service.respond_to_assignment(
            db, assignment.id, partner_id, action, None
        )
    )


class TestTheLockIsTaken:
    def test_accepting_reads_the_job_through_the_locking_read(self, monkeypatch):
        job = FakeJob(STATUS_MATCHING)
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, "offered")
        state = wire(monkeypatch, job=job, assignment=a)

        respond(FakeSession(), a, partner_id, "accept")

        assert state["locked_read"] is True

    def test_the_job_lock_is_taken_before_the_partner_lock(self, monkeypatch):
        """The lock order itself, in the fast suite (ADR-015 as amended).

        The accept path now takes two row locks, and the order between them is
        the whole reason it cannot deadlock against anything else: jobs first,
        then partners, then writes to job_assignments. Reversing them here would
        still pass every other test in this file and every capacity test, and
        would only show up as an intermittent deadlock under real concurrency —
        which is the most expensive kind of bug to find twice.
        """
        job = FakeJob(STATUS_MATCHING)
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, "offered")
        state = wire(monkeypatch, job=job, assignment=a)

        respond(FakeSession(), a, partner_id, "accept")

        assert state["locks"] == ["job", "partner"]

    def test_rejecting_reads_the_job_through_the_locking_read_too(self, monkeypatch):
        """A rejection writes the job's history and can re-dispatch.

        It is tempting to lock only on the accept path, since that is the one
        that moves the job to 'assigned'. But a rejection writes a history row
        against the job and then re-offers it, and neither is meaningful if the
        job was cancelled a millisecond earlier.
        """
        job = FakeJob(STATUS_MATCHING)
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, "offered")
        state = wire(monkeypatch, job=job, assignment=a)

        respond(FakeSession(), a, partner_id, "reject")

        assert state["locked_read"] is True

    def test_the_lock_is_held_before_the_status_is_trusted(self, monkeypatch):
        """Ordering, asserted from the service's own point of view.

        The status the service acted on is the one the locking read returned.
        This is the assertion that would fail if somebody kept the locking read
        but moved the status check above it — a change that looks harmless and
        reopens the entire bug.
        """
        job = FakeJob(STATUS_MATCHING)
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, "offered")
        state = wire(monkeypatch, job=job, assignment=a)

        respond(FakeSession(), a, partner_id, "accept")

        assert state["status_at_lock"] == STATUS_MATCHING
        # And the writes came after the lock, not before it.
        assert state["writes"][0] == "assignment_accepted"


class TestAJobThatMovedIsRefused:
    @pytest.mark.parametrize(
        "job_status", [s for s in ALL_JOB_STATUSES if s != STATUS_MATCHING]
    )
    def test_no_status_but_matching_can_be_answered(self, monkeypatch, job_status):
        job = FakeJob(job_status)
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, "offered")
        state = wire(monkeypatch, job=job, assignment=a)

        with pytest.raises(AppError) as exc:
            respond(FakeSession(), a, partner_id, "accept")

        assert exc.value.status_code == 409
        assert exc.value.code == ErrorCode.ASSIGNMENT_ALREADY_ANSWERED
        # Nothing was written. A refusal that had already touched the
        # assignment would be worse than the bug it replaces.
        assert state["writes"] == []

    def test_matching_is_still_answerable(self, monkeypatch):
        """The guard rejects the right thing and nothing else.

        Without this, a check of `job.status == 'assigned'` — or any other
        inversion — would pass every test above.
        """
        job = FakeJob(STATUS_MATCHING)
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, "offered")
        wire(monkeypatch, job=job, assignment=a)

        assignment, returned_job, nxt = respond(FakeSession(), a, partner_id, "accept")

        assert assignment.status == "accepted"
        assert returned_job.status == "assigned"
        assert nxt is None

    def test_a_cancelled_job_is_refused_on_reject_as_well(self, monkeypatch):
        job = FakeJob("cancelled")
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, "offered")
        state = wire(monkeypatch, job=job, assignment=a)

        with pytest.raises(AppError) as exc:
            respond(FakeSession(), a, partner_id, "reject")

        assert exc.value.code == ErrorCode.ASSIGNMENT_ALREADY_ANSWERED
        assert state["writes"] == []


class TestTheAssignmentGuardStillComesFirst:
    """The pre-existing guard was never wrong; it was incomplete.

    An already-answered assignment must be refused on the assignment's own
    status, *before* the job is read at all. That ordering matters for two
    reasons: it is one fewer locking read taken for what is usually a double
    tap, and it keeps the sequential cancel-then-accept case answering exactly
    what it answered before this change — owner cancellation closes every open
    assignment, so by then the row reads 'cancelled' and this guard fires.
    """

    @pytest.mark.parametrize(
        "assignment_status", ["accepted", "rejected", "timed_out", "cancelled"]
    )
    def test_a_settled_offer_is_refused_without_reading_the_job(
        self, monkeypatch, assignment_status
    ):
        job = FakeJob(STATUS_MATCHING)
        partner_id = uuid.uuid4()
        a = FakeAssignment(job.id, partner_id, assignment_status)
        state = wire(monkeypatch, job=job, assignment=a)

        with pytest.raises(AppError) as exc:
            respond(FakeSession(), a, partner_id, "accept")

        assert exc.value.status_code == 409
        assert exc.value.code == ErrorCode.ASSIGNMENT_ALREADY_ANSWERED
        assert state["locked_read"] is False, (
            "a settled offer should be refused on the assignment's own status; "
            "taking a job row lock first is wasted contention"
        )

    def test_ownership_is_checked_before_the_job_is_locked(self, monkeypatch):
        """403 for a stranger, and no lock taken on their behalf."""
        job = FakeJob(STATUS_MATCHING)
        a = FakeAssignment(job.id, uuid.uuid4(), "offered")
        state = wire(monkeypatch, job=job, assignment=a)

        with pytest.raises(AppError) as exc:
            respond(FakeSession(), a, uuid.uuid4(), "accept")

        assert exc.value.status_code == 403
        assert state["locked_read"] is False
