import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal, List
from pydantic import BaseModel, ConfigDict


class AdminBase(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[Literal["ops", "super_admin"]] = "ops"


class AdminCreate(AdminBase):
    pass


class AdminResponse(AdminBase):
    id: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminPartnerVerificationRequest(BaseModel):
    verification_status: Literal["verified", "rejected", "suspended", "pending"]
    notes: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class AdminPartnerSummary(BaseModel):
    id: uuid.UUID
    phone: str
    name: Optional[str] = None
    business_name: Optional[str] = None
    verification_status: str
    is_available: bool
    rating_avg: Optional[Decimal] = None
    rating_count: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminPartnerListResponse(BaseModel):
    items: List[AdminPartnerSummary]
    total: int

