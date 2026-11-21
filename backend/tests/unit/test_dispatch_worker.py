"""ADR-032: the dispatch worker — offer timeouts and server-side search escalation.

Like test_dispatch_locking, these pin the *shape* of the concurrency rules
(lock first, re-read under the lock, refuse anything that moved) against a fake
session. Proving the race closed against real Postgres locks is
tests/integration/check_dispatch_worker.py's job.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.job import Job, JobAssignment
from app.repositories import dispatch_repository, job_repository
from app.services import dispatch_service, dispatch_worker
from app.utils.errors import AppError, ErrorCode
from app.utils.scoring import OFFER_TTL_S, SEARCH_WINDOW_S, Candidate
from tests.unit.test_dispatch_locking import FakeAssignment, FakeJob, FakeSession, wire

NOW = datetime(2026, 11, 17, 12, 0, 0, tzinfo=timezone.utc)


# --- respond_to_assignment re-reads the offer under the job lock -------------

class SessionWhereTheWorkerWon(FakeSession):
    """The worker timed the offer out while this accept waited on the job lock.

    The accept read 'offered' before the lock. By the time the lock is granted
    the worker has committed 'timed_out' and the job is still 'matching' (it has
    been offered to the next partner), so only a re-read of the assignment can
    tell. refresh() is that re-read.
    """

    async def refresh(self, obj) -> None:
        if isinstance(obj, FakeAssignment):
            obj.status = "timed_out"
        await super().refresh(obj)


@pytest.mark.parametrize("action", ["accept", "reject"])
def test_an_answer_to_an_offer_the_worker_already_timed_out_is_409(monkeypatch, action):
    job = FakeJob("matching")
    partner_id = uuid.uuid4()
    a = FakeAssignment(job.id, partner_id, "offered")
    state = wire(monkeypatch, job=job, assignment=a)

    with pytest.raises(AppError) as exc:
        asyncio.run(dispatch_service.respond_to_assignment(
            SessionWhereTheWorkerWon(), a.id, partner_id, action, None))

    assert exc.value.code == ErrorCode.ASSIGNMENT_ALREADY_ANSWERED
    assert state["writes"] == [], "nothing may be written over a timed-out offer"
    assert state["locks"] == ["job"], "the job lock is taken before the re-read"


# --- expire_offer --------------------------------------------------------------

class ExpireSession(FakeSession):
    def __init__(self, events: list, refreshed_status=None) -> None:
        super().__init__()
        self.events = events
        self.refreshed_status = refreshed_status

    async def refresh(self, obj) -> None:
        self.events.append("reread")
        if self.refreshed_status is not None:
            obj.status = self.refreshed_status

    async def commit(self) -> None:
        self.events.append("commit")
        await super().commit()

    async def rollback(self) -> None:
        self.events.append("rollback")
        await super().rollback()


def _offer(status="offered", age_s=OFFER_TTL_S + 5) -> JobAssignment:
    return JobAssignment(
        id=uuid.uuid4(), job_id=uuid.uuid4(), partner_id=uuid.uuid4(),
        status=status, assignment_rank=1, offered_at=NOW - timedelta(seconds=age_s),
    )


def _wire_expire(monkeypatch, offer, job_status="matching"):
    events: list = []
    job = Job(id=offer.job_id, user_id=uuid.uuid4(), status=job_status, service_id=1,
              requested_at=NOW - timedelta(seconds=90))
    nxt = JobAssignment(id=uuid.uuid4(), job_id=job.id)

    async def get_assignment(_db, _id):
        events.append("read")
        return offer

    async def lock(_db, _id):
        events.append("lock")
        return job

    async def timed_out(_db, a):
        events.append("timed_out")
        a.status = "timed_out"

    async def offer_next(_db, j):
        events.append("offer_next")
        return nxt

    monkeypatch.setattr(dispatch_repository, "get_assignment_by_id", get_assignment)
    monkeypatch.setattr(job_repository, "get_job_by_id_for_update", lock)
    monkeypatch.setattr(dispatch_repository, "mark_assignment_timed_out", timed_out)
    monkeypatch.setattr(dispatch_service, "_offer_next", offer_next)
    return events, nxt


def test_a_stale_offer_is_timed_out_committed_then_passed_on(monkeypatch):
    offer = _offer()
    events, nxt = _wire_expire(monkeypatch, offer)

    got = asyncio.run(dispatch_service.expire_offer(ExpireSession(events), offer.id, now=NOW))

    assert got is nxt
    assert events == ["read", "lock", "reread", "timed_out", "commit", "offer_next"]


@pytest.mark.parametrize("refreshed", ["accepted", "rejected", "timed_out", "cancelled"])
def test_an_offer_answered_before_the_lock_is_left_alone(monkeypatch, refreshed):
    offer = _offer()
    events, _ = _wire_expire(monkeypatch, offer)

    got = asyncio.run(dispatch_service.expire_offer(
        ExpireSession(events, refreshed_status=refreshed), offer.id, now=NOW))

    assert got is None
    assert "timed_out" not in events and "offer_next" not in events
    assert events[-1] == "rollback"


@pytest.mark.parametrize("job_status", ["assigned", "cancelled", "no_match_found", "completed"])
def test_an_offer_on_a_job_that_moved_on_is_left_alone(monkeypatch, job_status):
    offer = _offer()
    events, _ = _wire_expire(monkeypatch, offer, job_status=job_status)

    assert asyncio.run(dispatch_service.expire_offer(ExpireSession(events), offer.id, now=NOW)) is None
    assert "timed_out" not in events


def test_an_offer_younger_than_the_ttl_is_left_alone(monkeypatch):
    offer = _offer(age_s=OFFER_TTL_S - 1)
    events, _ = _wire_expire(monkeypatch, offer)

    assert asyncio.run(dispatch_service.expire_offer(ExpireSession(events), offer.id, now=NOW)) is None
    assert "timed_out" not in events


def test_a_missing_offer_is_nothing_to_do(monkeypatch):
    async def none(_db, _id):
        return None
    monkeypatch.setattr(dispatch_repository, "get_assignment_by_id", none)
    assert asyncio.run(dispatch_service.expire_offer(FakeSession(), uuid.uuid4(), now=NOW)) is None


# --- widen_search_for_job --------------------------------------------------------

def test_the_worker_widens_a_search_without_an_owner(monkeypatch):
    job = Job(id=uuid.uuid4(), user_id=uuid.uuid4(), status="no_match_found", service_id=1,
              requested_at=datetime.now(timezone.utc) - timedelta(seconds=180))
    cand = Candidate(partner_id=str(uuid.uuid4()), distance_m=15_000, active_job_count=0,
                     rating_avg=4.5, rating_count=3)
    offered = JobAssignment(id=uuid.uuid4(), job_id=job.id)
    seen = {}

    async def get(_db, _id):
        return job

    async def find(_db, _job, **kw):
        seen.update(kw)
        return [cand]

    async def noop(*_a, **_k):
        return None

    async def offer(*_a, **kw):
        seen["rank"] = kw["assignment_rank"]
        return offered

    async def zero_rank(*_a):
        return 1

    async def asked(*_a):
        return set()

    monkeypatch.setattr(job_repository, "get_job_by_id", get)
    monkeypatch.setattr(job_repository, "get_job_by_id_for_update", get)
    monkeypatch.setattr(dispatch_repository, "get_offered_partner_ids", asked)
    monkeypatch.setattr(dispatch_repository, "get_max_assignment_rank", zero_rank)
    monkeypatch.setattr(dispatch_service, "find_candidates", find)
    monkeypatch.setattr(dispatch_service, "_transition", noop)
    monkeypatch.setattr(dispatch_service, "_create_offer", offer)

    res = asyncio.run(dispatch_service.widen_search_for_job(FakeSession(), job.id))

    assert seen["radius_m"] == 20_000
    assert seen["rank"] == 2
    assert res.status == "matching" and res.assignment is offered


def test_the_worker_widening_a_missing_job_is_nothing_to_do(monkeypatch):
    async def none(_db, _id):
        return None
    monkeypatch.setattr(job_repository, "get_job_by_id", none)
    assert asyncio.run(dispatch_service.widen_search_for_job(FakeSession(), uuid.uuid4())) is None


# --- sweep_once ----------------------------------------------------------------------

class _Ctx:
    async def __aenter__(self):
        return FakeSession()

    async def __aexit__(self, *_exc):
        return False


def _factory():
    return _Ctx()


async def _no_orphans(_db, **_k):
    return []


def test_a_sweep_times_out_offers_before_widening_searches(monkeypatch):
    order, cutoffs = [], {}
    offers = [uuid.uuid4(), uuid.uuid4()]
    jobs = [uuid.uuid4()]

    async def expired(_db, *, offered_before, limit=50):
        cutoffs["offered_before"] = offered_before
        return offers

    async def searchable(_db, *, requested_after, limit=50):
        cutoffs["requested_after"] = requested_after
        return jobs

    async def expire(_db, aid, now=None):
        order.append(("expire", aid))
        return JobAssignment(id=uuid.uuid4())

    async def widen(_db, jid):
        order.append(("widen", jid))
        return dispatch_service.SearchStatus("matching", 20_000, 200, 600, True, True,
                                             JobAssignment(id=uuid.uuid4()))

    monkeypatch.setattr(dispatch_repository, "get_expired_offer_ids", expired)
    monkeypatch.setattr(dispatch_repository, "get_searchable_job_ids", searchable)
    monkeypatch.setattr(dispatch_repository, "get_due_scheduled_job_ids", _no_due)
    monkeypatch.setattr(dispatch_repository, "get_orphaned_requested_job_ids", _no_orphans)
    monkeypatch.setattr(dispatch_service, "expire_offer", expire)
    monkeypatch.setattr(dispatch_service, "widen_search_for_job", widen)

    res = asyncio.run(dispatch_worker.sweep_once(_factory, now=NOW))

    assert order == [("expire", offers[0]), ("expire", offers[1]), ("widen", jobs[0])]
    assert cutoffs == {
        "offered_before": NOW - timedelta(seconds=OFFER_TTL_S),
        "requested_after": NOW - timedelta(seconds=SEARCH_WINDOW_S),
    }
    assert (res.offers_checked, res.reoffered, res.jobs_searched, res.jobs_rescued) == (2, 2, 1, 1)
    assert res.errors == []


def test_one_failing_item_does_not_stop_the_sweep(monkeypatch):
    bad, good = uuid.uuid4(), uuid.uuid4()
    done = []

    async def expired(_db, **_k):
        return [bad, good]

    async def searchable(_db, **_k):
        return []

    async def expire(_db, aid, now=None):
        if aid == bad:
            raise RuntimeError("redis down")
        done.append(aid)
        return None

    monkeypatch.setattr(dispatch_repository, "get_expired_offer_ids", expired)
    monkeypatch.setattr(dispatch_repository, "get_searchable_job_ids", searchable)
    monkeypatch.setattr(dispatch_repository, "get_due_scheduled_job_ids", _no_due)
    monkeypatch.setattr(dispatch_repository, "get_orphaned_requested_job_ids", _no_orphans)
    monkeypatch.setattr(dispatch_service, "expire_offer", expire)

    res = asyncio.run(dispatch_worker.sweep_once(_factory, now=NOW))

    assert done == [good]
    assert res.errors == [f"offer:{bad}:RuntimeError"]


def test_the_loop_survives_a_failing_sweep_and_stops_on_cancel(monkeypatch):
    calls = []

    async def sweep(_factory):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("database unreachable")

    monkeypatch.setattr(dispatch_worker, "sweep_once", sweep)

    async def main():
        task = asyncio.create_task(dispatch_worker.run_forever(0, _factory))
        while len(calls) < 3:
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(main())
    assert len(calls) >= 3


async def _no_due(_db, **_k):
    return []
