import uuid
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict


class VehicleBase(BaseModel):
    vehicle_type: Optional[Literal["two_wheeler", "four_wheeler"]] = None
    make: Optional[str] = None
    model: Optional[str] = None
    vehicle_number: str


class VehicleCreate(VehicleBase):
    user_id: Optional[uuid.UUID] = None


class VehicleUpdate(BaseModel):
    vehicle_type: Optional[Literal["two_wheeler", "four_wheeler"]] = None
    make: Optional[str] = None
    model: Optional[str] = None
    vehicle_number: Optional[str] = None


class VehicleResponse(VehicleBase):
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
