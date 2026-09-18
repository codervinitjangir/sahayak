import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional, Literal
from pydantic import BaseModel, ConfigDict, Field


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


class PartnerCreateRequest(BaseModel):
    """Inbound payload for POST /partners — what a mechanic signs up with.

    Deliberately narrower than PartnerCreate above: it takes a
    primary_category_code instead of a primary_category_id, so a client never
    has to know database ids, and it accepts nothing else. verification_status,
    is_available and the rating fields are server-owned — letting a registrant
    post their own verification_status would be a trivial privilege escalation.
    """
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=1, max_length=15)
    primary_category_code: Optional[str] = Field(default=None, max_length=30)


class PartnerAvailabilityRequest(BaseModel):
    """Inbound payload for PATCH /partners/{partner_id}/availability."""
    is_available: bool


class PartnerAvailabilityResponse(BaseModel):
    """Just the fields the availability toggle changes.

    Narrow on purpose: this endpoint is called repeatedly by a partner app
    going on and off shift, and it has no reason to re-send the partner's
    phone number or verification state on every toggle.
    """
    id: uuid.UUID
    is_available: bool
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PartnerServicesLinkRequest(BaseModel):
    """Inbound payload for POST /partners/{partner_id}/services.

    A list because one partner offers several services, and codes rather than
    ids for the same reason as everywhere else in the API.
    """
    service_codes: List[str] = Field(..., min_length=1)


class PartnerServiceItem(BaseModel):
    """One service a partner offers, joined back to the services table."""
    service_id: int
    code: str
    name: str

    model_config = ConfigDict(from_attributes=True)


class PartnerServicesResponse(BaseModel):
    """The partner's complete service list after the link operation.

    The full current set is returned rather than only the newly-inserted rows,
    because the endpoint is idempotent: a caller re-submitting an existing link
    gets the same answer as the first time, and never has to reconcile a delta.
    """
    partner_id: uuid.UUID
    services: List[PartnerServiceItem] = Field(default_factory=list)


class PartnerLocationRequest(BaseModel):
    """Inbound payload for POST /partners/{partner_id}/location.

    Bounds are enforced here rather than trusted, because an out-of-range
    coordinate does not fail loudly downstream — Redis rejects a latitude past
    ±85.05 with an error, but a longitude of 720 or a transposed lat/lng pair is
    a perfectly valid point somewhere nobody is standing. Catching it at the edge
    turns a silently-empty candidate search into a 422 that names the field.

    Written lat-first because that is how a human reads a coordinate and how a
    phone's GPS API returns one. The longitude-first order Redis and PostGIS want
    is applied at the call site, in one place, rather than being pushed onto
    every client.
    """
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class PartnerLocationResponse(BaseModel):
    """Acknowledgement that a position was recorded.

    Echoes nothing back but the time it landed. A partner app posts this every
    few seconds while on shift, so the response is the one place in the API where
    payload size is a real cost — and the client already knows where it is.

    Deliberately not a Postgres shape: nothing was written to Postgres. Live
    position lives only in Redis, which is why there is no updated_at column
    anywhere to read this from.
    """
    partner_id: uuid.UUID
    recorded_at: datetime


class PartnerAuthLinkResponse(BaseModel):
    """Confirmation that a Supabase account now owns this partner profile.

    Narrow like PartnerAvailabilityResponse, and for a sharper reason: the
    caller has just proved they hold the account, so echoing the profile's phone
    number back adds nothing they do not have — while making this endpoint one
    more place a mechanic's number can leak from.

    verification_status is included because it is the first thing a partner app
    needs after linking: a linked partner still cannot be dispatched until ops
    verify them, and the app should say so rather than show an availability
    toggle that will never produce work.
    """
    id: uuid.UUID
    auth_user_id: uuid.UUID
    verification_status: str

    model_config = ConfigDict(from_attributes=True)
