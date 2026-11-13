import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Literal, List
from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    notes: Optional[str] = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _reason_required_to_turn_a_partner_away(self):
        # Rejecting or suspending without saying why leaves the partner (and the next
        # admin) guessing. Verified/pending carry no note, so any text sent is dropped.
        if self.verification_status in ("rejected", "suspended"):
            self.notes = (self.notes or "").strip()
            if len(self.notes) < 3:
                raise ValueError("a reason (notes) is required to reject or suspend a partner")
        else:
            self.notes = None
        return self


class AdminPartnerSummary(BaseModel):
    id: uuid.UUID
    phone: str
    name: Optional[str] = None
    verification_status: str
    verification_note: Optional[str] = None
    is_available: bool
    rating_avg: Optional[Decimal] = None
    rating_count: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminPartnerListResponse(BaseModel):
    items: List[AdminPartnerSummary]
    total: int


class AdminPartnerDocument(BaseModel):
    """A verification document. `file_url` is deliberately not exposed: storage paths
    are not for the browser; the admin sees type, status and expiry, not the blob."""
    id: uuid.UUID
    doc_type: Optional[str] = None
    status: str
    has_file: bool
    rejection_reason: Optional[str] = None
    expiry_date: Optional[date] = None
    uploaded_at: datetime


class AdminPartnerEquipment(BaseModel):
    id: uuid.UUID
    equipment_type: Optional[str] = None
    registration_number: Optional[str] = None
    verification_status: str


class AdminPartnerDetail(AdminPartnerSummary):
    documents: List[AdminPartnerDocument]
    equipment: List[AdminPartnerEquipment]

