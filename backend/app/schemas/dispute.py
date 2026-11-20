import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

DisputeReason = Literal[
    "overcharged", "service_not_done", "partner_behaviour", "damage", "off_app_payment", "other"
]
DisputeStatus = Literal["open", "resolved", "rejected", "refunded"]
DisputeResolution = Literal["resolved", "rejected", "refunded"]


class DisputeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: DisputeReason
    description: Optional[str] = Field(default=None, max_length=1000)


class DisputeResolve(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resolution: DisputeResolution
    note: str = Field(..., min_length=3, max_length=1000)


class DisputeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    job_id: uuid.UUID
    reason: DisputeReason
    description: Optional[str] = None
    status: DisputeStatus
    resolution_note: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None


class DisputeListResponse(BaseModel):
    items: list[DisputeResponse]
    total: int
    limit: int
    offset: int


class ReceiptResponse(BaseModel):
    """A payment receipt. Not a GST tax invoice: Sahayak has no GSTIN on record
    yet, so `is_tax_invoice` is false and no tax line is invented."""
    receipt_number: str
    payment_id: uuid.UUID
    job_id: uuid.UUID
    service_name: Optional[str] = None
    vehicle_number: Optional[str] = None
    partner_name: Optional[str] = None
    pickup_address: Optional[str] = None
    completed_at: Optional[datetime] = None
    paid_at: datetime
    amount: Decimal
    currency: Literal["INR"] = "INR"
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    status: Literal["paid", "refunded"]
    is_tax_invoice: bool = False
