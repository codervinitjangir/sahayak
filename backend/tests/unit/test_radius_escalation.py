"""G1 / ADR-023: radius escalation for jobs that found nobody nearby."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.models.job import Job, JobAssignment
from app.services import dispatch_service
from app.utils import scoring
from app.utils.errors import NotFoundError
from app.utils.scoring import Candidate


@pytest.mark.parametrize(
    "elapsed, radius",
    [(0, 10_000), (119, 10_000), (120, 20_000), (299, 20_000), (300, 35_000), (599, 35_000), (5000, 35_000)],
)
def test_radius_widens_with_age_and_never_past_the_last_tier(elapsed, radius):
    assert scoring.search_radius_m(elapsed) == radius


def test_window_closes_at_ten_minutes():
    assert scoring.search_window_open(599)
    assert not scoring.search_window_open(600)


def test_distance_score_is_relative_to_the_circle_searched():
    far = Candidate(partner_id="p", distance_m=15_000, active_job_count=0, rating_avg=0.0, rating_count=0)
    assert scoring.distance_score(far.distance_m) == 0.0
    assert scoring.distance_score(far.distance_m, 20_000) == pytest.approx(0.25)


def _job(status: str, age_s: int, owner: uuid.UUID) -> Job:
    return Job(
        id=uuid.uuid4(), user_id=owner, status=status, service_id=1,
        requested_at=datetime.now(timezone.utc) - timedelta(seconds=age_s),
    )


def _patches(job, *, candidates, locked=None):
    return [
        patch("app.repositories.job_repository.get_job_by_id", AsyncMock(return_value=job)),
        patch("app.repositories.job_repository.get_job_by_id_for_update", AsyncMock(return_value=locked or job)),
        patch("app.repositories.dispatch_repository.get_offered_partner_ids", AsyncMock(return_value={uuid.uuid4()})),
        patch("app.repositories.dispatch_repository.get_max_assignment_rank", AsyncMock(return_value=2)),
        patch("app.services.dispatch_service.find_candidates", AsyncMock(return_value=candidates)),
        patch("app.services.dispatch_service._transition", AsyncMock()),
        patch("app.services.dispatch_service._create_offer",
              AsyncMock(return_value=JobAssignment(id=uuid.uuid4(), job_id=job.id))),
    ]


async def _run(job, owner, **kw):
    ps = _patches(job, **kw)
    mocks = [p.start() for p in ps]
    try:
        res = await dispatch_service.retry_search(AsyncMock(), job.id, owner)
    finally:
        for p in ps:
            p.stop()
    return res, dict(zip(
        ["get", "lock", "offered", "rank", "find", "transition", "offer"], mocks))


@pytest.mark.asyncio
async def test_retry_three_minutes_in_searches_20km_and_offers():
    owner = uuid.uuid4()
    job = _job("no_match_found", 180, owner)
    cand = Candidate(partner_id=str(uuid.uuid4()), distance_m=15_000, active_job_count=0,
                     rating_avg=4.5, rating_count=3)
    res, m = await _run(job, owner, candidates=[cand])

    assert m["find"].await_args.kwargs["radius_m"] == 20_000
    assert m["find"].await_args.kwargs["exclude_partner_ids"]  # skips partners already asked
    assert m["transition"].await_args.args[2] == "matching"
    assert m["offer"].await_args.kwargs["assignment_rank"] == 3
    assert res.status == "matching" and res.searched and res.assignment is not None


@pytest.mark.asyncio
async def test_retry_with_nobody_leaves_the_job_alone():
    owner = uuid.uuid4()
    job = _job("no_match_found", 30, owner)
    res, m = await _run(job, owner, candidates=[])
    assert res.status == "no_match_found" and res.searched and res.window_open
    assert res.radius_m == 10_000
    m["transition"].assert_not_awaited()
    m["offer"].assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_after_window_does_not_search():
    owner = uuid.uuid4()
    job = _job("no_match_found", 700, owner)
    res, m = await _run(job, owner, candidates=[])
    assert not res.window_open and not res.searched
    m["find"].assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_on_a_job_that_moved_on_is_a_no_op():
    owner = uuid.uuid4()
    job = _job("assigned", 60, owner)
    res, m = await _run(job, owner, candidates=[])
    assert res.status == "assigned" and not res.searched
    m["find"].assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_during_search_wins():
    owner = uuid.uuid4()
    job = _job("no_match_found", 180, owner)
    cancelled = _job("cancelled", 180, owner)
    cancelled.id = job.id
    cand = Candidate(partner_id=str(uuid.uuid4()), distance_m=1_000, active_job_count=0,
                     rating_avg=0.0, rating_count=0)
    res, m = await _run(job, owner, candidates=[cand], locked=cancelled)
    m["transition"].assert_not_awaited()
    m["offer"].assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_on_someone_elses_job_is_404():
    job = _job("no_match_found", 30, uuid.uuid4())
    with pytest.raises(NotFoundError):
        await _run(job, uuid.uuid4(), candidates=[])
