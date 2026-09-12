import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict


class PaymentBase(BaseModel):
    amount: Optional[Decimal] = None
    status: Optional[Literal["pending", "paid", "failed", "refunded"]] = "pending"
    payment_method: Optional[str] = None
    gateway_ref_id: Optional[str] = None


class PaymentCreate(PaymentBase):
    job_id: uuid.UUID


class PaymentResponse(PaymentBase):
    id: uuid.UUID
    job_id: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
