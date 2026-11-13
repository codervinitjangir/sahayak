import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict, Field


PaymentMethod = Literal["upi", "cash", "card", "netbanking"]
PaymentStatus = Literal["pending", "paid", "failed", "refunded"]


class PaymentBase(BaseModel):
    amount: Optional[Decimal] = Field(default=None, ge=0)
    status: Optional[PaymentStatus] = "pending"
    payment_method: Optional[PaymentMethod] = None
    gateway_ref_id: Optional[str] = Field(default=None, max_length=100)


class PaymentCreate(BaseModel):
    # No amount field: the figure always comes from the job row
    # (payment_service._job_amount). An `amount` a client still sends is
    # ignored, not trusted.
    job_id: uuid.UUID
    payment_method: Optional[PaymentMethod] = "upi"
    gateway_ref_id: Optional[str] = Field(default=None, max_length=100)


class PaymentConfirmRequest(BaseModel):
    gateway_ref_id: Optional[str] = Field(default=None, max_length=100)
    payment_method: Optional[PaymentMethod] = None


class PaymentResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    amount: Optional[Decimal] = None
    status: PaymentStatus
    payment_method: Optional[str] = None
    gateway_ref_id: Optional[str] = None
    upi_intent: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
