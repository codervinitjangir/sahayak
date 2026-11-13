"""Response and request shapes for the admin back office (ADR-024)."""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class AdminJobItem(BaseModel):
    """One row on the live jobs board. Staff see contact details: that is
    what the board is for (calling a stranded owner or a late partner)."""

    id: uuid.UUID
    status: str
    service_name: Optional[str] = None
    vehicle_number: Optional[str] = None
    pickup_address_text: Optional[str] = None
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None
    partner_name: Optional[str] = None
    partner_phone: Optional[str] = None
    assignment_status: Optional[str] = Field(
        default=None, description="Status of the newest assignment (offered, accepted, ...)."
    )
    price_estimate: Optional[Decimal] = None
    price_final: Optional[Decimal] = None
    requested_at: datetime
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None


class AdminJobListResponse(BaseModel):
    items: list[AdminJobItem]
    total: int
    limit: int
    offset: int


class AdminJobCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=3, max_length=500, description="Required: goes in the audit log.")


class AdminUserItem(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    email: Optional[str] = None
    created_at: datetime
    job_count: int
    has_login: bool
    suspended_at: Optional[datetime] = None
    suspension_reason: Optional[str] = None


class AdminUserListResponse(BaseModel):
    items: list[AdminUserItem]
    total: int
    limit: int
    offset: int


class AdminUserSuspensionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    suspended: bool
    reason: Optional[str] = Field(default=None, max_length=500)


class AdminAuditEntry(BaseModel):
    id: uuid.UUID
    admin_id: Optional[uuid.UUID] = None
    action: str
    target_type: str
    target_id: uuid.UUID
    reason: Optional[str] = None
    details: Optional[dict[str, Any]] = None
    created_at: datetime


class AdminAuditListResponse(BaseModel):
    items: list[AdminAuditEntry]
    total: int
    limit: int
    offset: int
