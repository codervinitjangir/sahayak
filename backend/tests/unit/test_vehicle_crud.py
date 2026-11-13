import uuid
from unittest.mock import AsyncMock, patch
import pytest

from app.models.vehicle import Vehicle
from app.schemas.vehicle import VehicleUpdateRequest
from app.services import vehicle_service
from app.utils.errors import ConflictError, NotFoundError


@pytest.mark.asyncio
async def test_update_vehicle_success():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    vehicle_id = uuid.uuid4()

    mock_vehicle = Vehicle(
        id=vehicle_id,
        user_id=owner_id,
        vehicle_type="four_wheeler",
        make="Hyundai",
        model="i20",
        vehicle_number="KA01AB1234",
    )

    with patch("app.repositories.vehicle_repository.get_vehicle_by_id", return_value=mock_vehicle), \
         patch("app.repositories.vehicle_repository.update_vehicle_row", return_value=mock_vehicle):
        payload = VehicleUpdateRequest(model="i20 Sportz")
        res = await vehicle_service.update_user_vehicle(db, vehicle_id, payload, owner_id)
        assert res.id == vehicle_id


@pytest.mark.asyncio
async def test_update_vehicle_not_owner():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    stranger_id = uuid.uuid4()
    vehicle_id = uuid.uuid4()

    mock_vehicle = Vehicle(
        id=vehicle_id,
        user_id=owner_id,
        vehicle_type="four_wheeler",
        make="Hyundai",
        model="i20",
        vehicle_number="KA01AB1234",
    )

    with patch("app.repositories.vehicle_repository.get_vehicle_by_id", return_value=mock_vehicle):
        payload = VehicleUpdateRequest(model="i20 Sportz")
        with pytest.raises(NotFoundError):
            await vehicle_service.update_user_vehicle(db, vehicle_id, payload, stranger_id)


@pytest.mark.asyncio
async def test_delete_vehicle_active_job_conflict():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    vehicle_id = uuid.uuid4()

    mock_vehicle = Vehicle(
        id=vehicle_id,
        user_id=owner_id,
        vehicle_type="four_wheeler",
        make="Hyundai",
        model="i20",
        vehicle_number="KA01AB1234",
    )

    with patch("app.repositories.vehicle_repository.get_vehicle_by_id", return_value=mock_vehicle), \
         patch("app.repositories.vehicle_repository.has_active_jobs", return_value=True):
        with pytest.raises(ConflictError):
            await vehicle_service.delete_user_vehicle(db, vehicle_id, owner_id)


@pytest.mark.asyncio
async def test_delete_vehicle_success():
    db = AsyncMock()
    owner_id = uuid.uuid4()
    vehicle_id = uuid.uuid4()

    mock_vehicle = Vehicle(
        id=vehicle_id,
        user_id=owner_id,
        vehicle_type="four_wheeler",
        make="Hyundai",
        model="i20",
        vehicle_number="KA01AB1234",
    )

    with patch("app.repositories.vehicle_repository.get_vehicle_by_id", return_value=mock_vehicle), \
         patch("app.repositories.vehicle_repository.has_active_jobs", return_value=False), \
         patch("app.repositories.vehicle_repository.detach_vehicle_from_jobs", return_value=None), \
         patch("app.repositories.vehicle_repository.delete_vehicle_by_id", return_value=None):
        res = await vehicle_service.delete_user_vehicle(db, vehicle_id, owner_id)
        assert res["id"] == vehicle_id
        assert res["deleted"] is True

