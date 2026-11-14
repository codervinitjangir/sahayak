"""Staff accounts and invites (ADR-029)."""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

StaffRole = Literal["super_admin", "ops", "support", "finance"]


class StaffMember(BaseModel):
    id: uuid.UUID
    name: Optional[str] = None
    role: str
    phone: Optional[str] = None
    has_login: bool
    disabled_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    is_you: bool = False


class StaffInvite(BaseModel):
    """An open invite. Never carries the token: that is returned once, at creation."""

    id: uuid.UUID
    name: str
    role: str
    phone: str
    created_at: Optional[datetime] = None
    expires_at: datetime
    expired: bool


class StaffListResponse(BaseModel):
    staff: list[StaffMember]
    invites: list[StaffInvite]
    your_role: str


class StaffInviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=2, max_length=100)
    phone: str = Field(..., pattern=r"^\+[1-9]\d{9,13}$", description="E.164, e.g. +919876543210.")
    role: StaffRole


class StaffInviteCreated(StaffInvite):
    token: str = Field(..., description="Shown once. Send it to the invitee over a channel you trust.")


class StaffInviteAcceptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(..., min_length=20, max_length=200)


class StaffUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Optional[StaffRole] = None
    disabled: Optional[bool] = None
    reason: str = Field(..., min_length=3, max_length=500, description="Required: goes in the audit log.")
