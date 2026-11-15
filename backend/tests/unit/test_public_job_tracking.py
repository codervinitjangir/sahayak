import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch
import pytest

from app.models.job import Job, JobAssignment
from app.models.partner import Partner
from app.models.service import Service
from app.services import job_service
from app.utils.errors import NotFoundError


@pytest.mark.asyncio
async def test_get_public_job_tracking_not_found():
    db = AsyncMock()
    job_id = uuid.uuid4()

    with patch("app.repositories.job_repository.get_job_by_id", return_value=None):
        with pytest.raises(NotFoundError):
            await job_service.get_public_job_tracking(db, job_id, job_service.share_token_for(job_id))


@pytest.mark.asyncio
async def test_get_public_job_tracking_success_with_partner_and_redis():
    db = AsyncMock()
    job_id = uuid.uuid4()
    partner_id = uuid.uuid4()

    mock_job = Job(
        id=job_id,
        user_id=uuid.uuid4(),
        status="partner_en_route",
        service_id=1,
        vehicle_number="KA01AB1234",
        pickup_address_text="MG Road, Bangalore",
        requested_at=datetime.now(timezone.utc),
        start_code="4321",  # sensitive field: must NOT be in public response
    )

    mock_service = Service(id=1, code="battery_jumpstart", name="Battery Jumpstart")
    mock_assignment = JobAssignment(
        id=uuid.uuid4(),
        job_id=job_id,
        partner_id=partner_id,
        status="accepted",
        estimated_arrival_min=12,
    )
    mock_partner = Partner(
        id=partner_id,
        name="Ramesh Kumar",
        phone="+919876543210",  # sensitive: must not be in public response
        rating_avg=Decimal("4.85"),
        rating_count=24,
    )

    mock_redis = AsyncMock()
    mock_redis.geopos.return_value = [(77.5950, 12.9720)]
    now_ts = str(datetime.now(timezone.utc).timestamp())
    mock_redis.get.return_value = now_ts

    with patch("app.repositories.job_repository.get_job_by_id", return_value=mock_job), \
         patch("app.repositories.service_repository.get_service_by_id", return_value=mock_service), \
         patch("app.repositories.job_repository.get_responsible_assignment", return_value=mock_assignment), \
         patch("app.repositories.job_repository.get_partner_by_id", return_value=mock_partner), \
         patch("app.services.job_service._pickup_coordinates", return_value=(12.9716, 77.5946)), \
         patch("app.services.job_service.get_redis", return_value=mock_redis):

        res = await job_service.get_public_job_tracking(db, job_id, job_service.share_token_for(job_id))

        assert res.id == job_id
        assert res.status == "partner_en_route"
        assert res.service_name == "Battery Jumpstart"
        assert res.vehicle_number == "KA01AB1234"
        assert res.partner_name == "Ramesh Kumar"
        assert res.partner_rating == 4.85
        assert res.partner_rating_count == 24
        assert res.estimated_arrival_min == 12
        assert res.partner_lat == 12.9720
        assert res.partner_lng == 77.5950
        assert res.partner_location_updated_at is not None
        assert res.emergency_helpline == "+91 92505 43490"
        assert res.sos_number == "112"
        # Ensure private fields are not exposed
        assert not hasattr(res, "start_code")
        assert not hasattr(res, "owner_phone")
        assert not hasattr(res, "partner_phone")
