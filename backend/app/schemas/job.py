import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Literal
from pydantic import BaseModel, ConfigDict


# Job Assignment schemas
class JobAssignmentBase(BaseModel):
    partner_id: Optional[uuid.UUID] = None
    status: Optional[
        Literal["offered", "accepted", "rejected", "timed_out", "completed"]
    ] = "offered"
    distance_at_offer_m: Optional[Decimal] = None
    estimated_arrival_min: Optional[int] = None
    matching_score: Optional[Decimal] = None
    assignment_rank: Optional[int] = None
    rejection_reason: Optional[str] = None


class JobAssignmentCreate(JobAssignmentBase):
    job_id: uuid.UUID


class JobAssignmentResponse(JobAssignmentBase):
    id: uuid.UUID
    job_id: uuid.UUID
    offered_at: datetime
    responded_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# Job Status History schemas
class JobStatusHistoryBase(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


class JobStatusHistoryCreate(JobStatusHistoryBase):
    job_id: uuid.UUID


class JobStatusHistoryResponse(JobStatusHistoryBase):
    id: uuid.UUID
    job_id: uuid.UUID
    changed_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Job schemas
class JobBase(BaseModel):
    service_id: int
    vehicle_id: Optional[uuid.UUID] = None
    vehicle_number: Optional[str] = None
    pickup_address_text: Optional[str] = None
    issue_description: Optional[str] = None
    issue_photo_urls: Optional[List[str]] = None
    price_estimate: Optional[Decimal] = None


class JobCreate(JobBase):
    user_id: Optional[uuid.UUID] = None
    pickup_latitude: float
    pickup_longitude: float
    drop_latitude: Optional[float] = None
    drop_longitude: Optional[float] = None


class JobResponse(JobBase):
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    status: str
    price_final: Optional[Decimal] = None
    requested_at: datetime
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
