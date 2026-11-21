"""Sahayak Care (ADR-051): plans, memberships, staff grant and revoke."""
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CarePlanResponse(BaseModel):
    code: str
    name: str
    callouts: int
    term_days: int


class CareMembershipResponse(BaseModel):
    id: uuid.UUID
    plan_code: str
    plan_name: str
    starts_at: datetime
    ends_at: datetime
    callouts_allowed: int
    # Counted from linked jobs that are open or completed (never stored).
    callouts_used: int
    callouts_left: int
    # True while the membership is in force (not revoked, inside its term).
    active: bool
    revoked_at: Optional[datetime] = None
    revoke_reason: Optional[str] = None


class MyCareResponse(BaseModel):
    """GET /users/me/care. `membership` is the one in force, or null.
    `pricing_note` is the honest line every client shows next to "Covered":
    until payments go live a covered call-out costs the same as any other."""
    membership: Optional[CareMembershipResponse] = None
    plans: list[CarePlanResponse] = Field(default_factory=list)
    pricing_note: str


class AdminUserCareResponse(BaseModel):
    current: Optional[CareMembershipResponse] = None
    history: list[CareMembershipResponse] = Field(default_factory=list)


class AdminCareGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_code: str = Field("care", min_length=1, max_length=40)
    reason: str = Field(..., min_length=3, max_length=500)


class AdminCareRevokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=3, max_length=500)
