"""Schemas for the 2026-11-21 job safeguards (ADR-039 to ADR-042)."""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

PhotoStage = Literal["pickup", "drop"]
PhotoContentType = Literal["image/jpeg", "image/png", "image/webp"]


class PriceRevisionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)
    reason: str = Field(..., min_length=5, max_length=500)


class PriceRevisionDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: bool


class PriceRevisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    proposed_amount: Decimal
    reason: str
    status: Literal["pending", "approved", "rejected", "withdrawn"]
    created_at: datetime
    decided_at: Optional[datetime] = None


class PhotoUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: PhotoStage
    content_type: PhotoContentType


class OwnerPhotoUploadRequest(BaseModel):
    """ADR-055: the owner's photo of the problem. The stage is always 'issue'."""
    model_config = ConfigDict(extra="forbid")
    content_type: PhotoContentType


class PhotoUploadTicket(BaseModel):
    photo_id: uuid.UUID
    upload_url: str
    max_bytes: int


class JobPhotoItem(BaseModel):
    id: uuid.UUID
    stage: Literal["pickup", "drop", "issue"]
    uploaded_at: Optional[datetime] = None


class JobPhotoViewUrl(BaseModel):
    url: str
    expires_in: int


class JobSafeguardsResponse(BaseModel):
    """GET /jobs/{id}/safeguards: what the owner and partner screens poll beside GET /jobs/{id}."""
    job_id: uuid.UUID
    status: str
    price_estimate: Optional[Decimal] = None
    # The highest final price the partner may enter without asking (estimate + 10%,
    # or the highest approved revision). Null when there is no estimate and nothing
    # approved: then any price needs the owner's approval.
    price_allowed_max: Optional[Decimal] = None
    # The hard ceiling no approval can pass (PRICE_FINAL_OUT_OF_RANGE).
    price_ceiling: Decimal
    pending_revision: Optional[PriceRevisionResponse] = None
    revisions: list[PriceRevisionResponse] = Field(default_factory=list)
    photos_required: bool = False
    photos: list[JobPhotoItem] = Field(default_factory=list)
    # ADR-041: when the owner may ask for another partner; null if not applicable.
    new_partner_available_at: Optional[datetime] = None
    can_request_new_partner: bool = False
