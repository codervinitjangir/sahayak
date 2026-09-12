import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict


# Partner Service schemas
class PartnerServiceBase(BaseModel):
    partner_id: uuid.UUID
    service_id: int


class PartnerServiceCreate(PartnerServiceBase):
    pass


class PartnerServiceResponse(PartnerServiceBase):
    model_config = ConfigDict(from_attributes=True)


# Partner Equipment schemas
class PartnerEquipmentBase(BaseModel):
    equipment_type: Optional[str] = None
    registration_number: Optional[str] = None
    verification_status: Optional[Literal["pending", "verified", "rejected"]] = "pending"


class PartnerEquipmentCreate(PartnerEquipmentBase):
    partner_id: uuid.UUID


class PartnerEquipmentResponse(PartnerEquipmentBase):
    id: uuid.UUID
    partner_id: uuid.UUID
    verified_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Partner Document schemas
class PartnerDocumentBase(BaseModel):
    doc_type: Optional[str] = None
    file_url: Optional[str] = None
    status: Optional[Literal["pending", "approved", "rejected", "expired"]] = "pending"
    rejection_reason: Optional[str] = None
    expiry_date: Optional[date] = None


class PartnerDocumentCreate(PartnerDocumentBase):
    partner_id: uuid.UUID


class PartnerDocumentResponse(PartnerDocumentBase):
    id: uuid.UUID
    partner_id: uuid.UUID
    verified_by: Optional[uuid.UUID] = None
    verified_at: Optional[datetime] = None
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Partner schemas
class PartnerBase(BaseModel):
    name: str
    phone: str
    primary_category_id: Optional[int] = None
    verification_status: Optional[
        Literal["pending", "verified", "rejected", "suspended"]
    ] = "pending"
    is_independent_contractor: Optional[bool] = True
    is_available: Optional[bool] = False
    rating_avg: Optional[Decimal] = Decimal("0.0")
    rating_count: Optional[int] = 0


class PartnerCreate(BaseModel):
    name: str
    phone: str
    primary_category_id: Optional[int] = None
    is_independent_contractor: Optional[bool] = True


class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    primary_category_id: Optional[int] = None
    is_available: Optional[bool] = None
    verification_status: Optional[
        Literal["pending", "verified", "rejected", "suspended"]
    ] = None


class PartnerResponse(PartnerBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
