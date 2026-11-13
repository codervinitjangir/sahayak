"""R7 remainder: a share link stops revealing anything once the job is over,
dies a day after that, and is rate limited per caller."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
import pytest

from app.models.job import Job, JobAssignment
from app.models.partner import Partner
from app.services import job_service
from app.utils import rate_limit
from app.utils.errors import AppError, NotFoundError


def _job(status: str, ended_ago: timedelta | None) -> Job:
    now = datetime.now(timezone.utc)
    job = Job(
        id=uuid.uuid4(), user_id=uuid.uuid4(), status=status, service_id=1,
        vehicle_number="KA01AB1234", pickup_address_text="MG Road",
        requested_at=now - timedelta(hours=2),
    )
    if ended_ago is not None:
        if status == "completed":
            job.completed_at = now - ended_ago
        else:
            job.cancelled_at = now - ended_ago
    return job


async def _track(job: Job):
    db = AsyncMock()
    assignment = JobAssignment(id=uuid.uuid4(), job_id=job.id, partner_id=uuid.uuid4(), status="completed")
    partner = Partner(id=assignment.partner_id, name="Ramesh", rating_count=0)
    with patch("app.repositories.job_repository.get_job_by_id", return_value=job), \
         patch("app.repositories.service_repository.get_service_by_id", return_value=None), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=assignment), \
         patch("app.repositories.job_repository.get_partner_by_id", return_value=partner), \
         patch("app.services.job_service._pickup_coordinates", return_value=(12.97, 77.59)):
        return await job_service.get_public_job_tracking(db, job.id, job_service.share_token_for(job.id))


@pytest.mark.asyncio
async def test_finished_job_reveals_status_only():
    res = await _track(_job("completed", timedelta(minutes=10)))
    assert res.status == "completed"
    assert res.pickup_lat is None and res.pickup_lng is None
    assert res.pickup_address_text is None
    assert res.vehicle_number is None
    assert res.partner_name is None


@pytest.mark.asyncio
async def test_link_dies_a_day_after_the_job_ends():
    with pytest.raises(NotFoundError):
        await _track(_job("completed", timedelta(hours=25)))
    with pytest.raises(NotFoundError):
        await _track(_job("cancelled", timedelta(hours=25)))


@pytest.mark.asyncio
async def test_live_job_still_shows_pickup_and_partner():
    res = await _track(_job("partner_en_route", None))
    assert res.pickup_lat == 12.97
    assert res.partner_name == "Ramesh"


@pytest.mark.asyncio
async def test_public_tracking_is_rate_limited_per_caller():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("app.utils.rate_limit.get_redis", return_value=redis):
        for _ in range(rate_limit.PUBLIC_TRACKING_PER_MINUTE):
            await rate_limit.check("public-tracking", "1.2.3.4", rate_limit.PUBLIC_TRACKING_PER_MINUTE)
        with pytest.raises(AppError) as exc:
            await rate_limit.check("public-tracking", "1.2.3.4", rate_limit.PUBLIC_TRACKING_PER_MINUTE)
        assert exc.value.status_code == 429
        # A different caller has their own budget.
        await rate_limit.check("public-tracking", "5.6.7.8", rate_limit.PUBLIC_TRACKING_PER_MINUTE)


@pytest.mark.asyncio
async def test_rate_limit_fails_open_when_redis_is_down():
    broken = AsyncMock()
    broken.incr.side_effect = ConnectionError("redis down")
    with patch("app.utils.rate_limit.get_redis", return_value=broken):
        await rate_limit.check("public-tracking", "1.2.3.4", 1)
