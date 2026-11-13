import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
import pytest

from app.models.job import Job, JobAssignment
from app.services import job_service
from app.services.auth_service import Identity
from app.utils.errors import NotFoundError


@pytest.mark.asyncio
async def test_get_job_partner_location_not_found():
    db = AsyncMock()
    identity = Identity(role="user", local_id=uuid.uuid4(), auth_user_id="auth-1")
    job_id = uuid.uuid4()

    with patch("app.repositories.job_repository.get_job_by_id", return_value=None):
        with pytest.raises(NotFoundError):
            await job_service.get_job_partner_location(db, job_id, identity)


@pytest.mark.asyncio
async def test_get_job_partner_location_unauthorized_user():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    stranger_id = uuid.uuid4()
    identity = Identity(role="user", local_id=stranger_id, auth_user_id="auth-stranger")
    job_id = uuid.uuid4()

    mock_job = Job(id=job_id, user_id=owner_id, status="partner_en_route")

    with patch("app.repositories.job_repository.get_job_by_id", return_value=mock_job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None):
        with pytest.raises(NotFoundError):
            await job_service.get_job_partner_location(db, job_id, identity)


@pytest.mark.asyncio
async def test_get_job_partner_location_unassigned_returns_null():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job_id = uuid.uuid4()

    mock_job = Job(id=job_id, user_id=owner_id, status="matching")

    with patch("app.repositories.job_repository.get_job_by_id", return_value=mock_job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=None):
        res = await job_service.get_job_partner_location(db, job_id, identity)
        assert res.partner_id is None
        assert res.status == "matching"
        assert res.latitude is None
        assert res.longitude is None


@pytest.mark.asyncio
async def test_get_job_partner_location_reads_from_redis():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    partner_id = uuid.uuid4()
    identity = Identity(role="user", local_id=owner_id, auth_user_id="auth-owner")
    job_id = uuid.uuid4()

    mock_job = Job(id=job_id, user_id=owner_id, status="partner_en_route")
    mock_assignment = JobAssignment(
        id=uuid.uuid4(),
        job_id=job_id,
        partner_id=partner_id,
        status="accepted",
        accepted_at=datetime.now(timezone.utc),
    )

    mock_redis = AsyncMock()
    mock_redis.geopos.return_value = [(77.5946, 12.9716)]
    now_ts = str(datetime.now(timezone.utc).timestamp())
    mock_redis.get.return_value = now_ts

    with patch("app.repositories.job_repository.get_job_by_id", return_value=mock_job), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=mock_assignment), \
         patch("app.services.job_service.get_redis", return_value=mock_redis):
        res = await job_service.get_job_partner_location(db, job_id, identity)
        assert res.partner_id == partner_id
        assert res.status == "partner_en_route"
        assert res.latitude == 12.9716
        assert res.longitude == 77.5946
        assert res.updated_at is not None
