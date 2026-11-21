"""Job chat (ADR-058) and the owner's live location (ADR-057)."""
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class JobMessageCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=500)

    @field_validator("body")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message cannot be empty")
        return v


class JobMessageItem(BaseModel):
    id: uuid.UUID
    sender: Literal["owner", "partner"]
    mine: bool
    body: str
    created_at: datetime


class JobMessageListResponse(BaseModel):
    items: List[JobMessageItem]
    can_send: bool = Field(..., description="False once the job has ended; the thread stays readable.")


class OwnerLocationUpdate(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    accuracy_m: Optional[float] = Field(None, ge=0, le=10000)


class OwnerLocationResponse(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_m: Optional[float] = None
    updated_at: Optional[datetime] = None
    sharing: bool = Field(..., description="False when there is no fix from the last 2 minutes.")
