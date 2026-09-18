import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Literal
from pydantic import BaseModel, ConfigDict, Field


# Job Assignment schemas
class JobAssignmentBase(BaseModel):
    partner_id: Optional[uuid.UUID] = None
    status: Optional[
        Literal["offered", "accepted", "rejected", "timed_out", "completed"]
    ] = "offered"
    distance_at_offer_m: Optional[Decimal] = None
    estimated_arrival_min: Optional[int] = None
    matching_score: Optional[Decimal] = None
    assignment_rank: Optional[int] = None
    rejection_reason: Optional[str] = None


class JobAssignmentCreate(JobAssignmentBase):
    job_id: uuid.UUID


class JobAssignmentResponse(JobAssignmentBase):
    id: uuid.UUID
    job_id: uuid.UUID
    offered_at: datetime
    responded_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# Job Status History schemas
class JobStatusHistoryBase(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


class JobStatusHistoryCreate(JobStatusHistoryBase):
    job_id: uuid.UUID


class JobStatusHistoryResponse(JobStatusHistoryBase):
    id: uuid.UUID
    job_id: uuid.UUID
    changed_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Job schemas
class JobBase(BaseModel):
    service_id: int
    vehicle_id: Optional[uuid.UUID] = None
    vehicle_number: Optional[str] = None
    pickup_address_text: Optional[str] = None
    issue_description: Optional[str] = None
    issue_photo_urls: Optional[List[str]] = None
    price_estimate: Optional[Decimal] = None


class JobCreate(JobBase):
    user_id: Optional[uuid.UUID] = None
    pickup_latitude: float
    pickup_longitude: float
    drop_latitude: Optional[float] = None
    drop_longitude: Optional[float] = None


class JobResponse(JobBase):
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    status: str
    price_final: Optional[Decimal] = None
    requested_at: datetime
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class JobCreateRequest(BaseModel):
    """Inbound payload for POST /jobs — what a driver's app sends on breakdown.

    Deliberately different from JobCreate above: it takes a service_code instead
    of a service_id and plain pickup_lat/pickup_lng floats, so a client never has
    to know database ids or how to spell PostGIS WKT. The service layer resolves
    the code and builds the geography point.

    There is no user_id here, and there must not be one. The requester's identity
    comes from the verified Supabase token via Depends(require_user); a client
    that sends user_id anyway has it ignored, because Pydantic drops unknown
    fields by default. Re-adding it would reopen the impersonation hole this
    field used to be.
    """
    vehicle_id: uuid.UUID
    service_code: str = Field(..., min_length=1, max_length=40)
    pickup_lat: float = Field(..., ge=-90.0, le=90.0)
    pickup_lng: float = Field(..., ge=-180.0, le=180.0)
    pickup_address_text: Optional[str] = None
    issue_description: Optional[str] = None


class CurrentAssignmentResponse(BaseModel):
    """The job's current partner situation, flattened from job_assignments plus
    the partners row it points at, so a client can render "who is coming" without
    a second round trip."""
    status: str
    partner_id: Optional[uuid.UUID] = None
    partner_name: Optional[str] = None
    partner_phone: Optional[str] = None
    partner_rating: Optional[Decimal] = None
    estimated_arrival_min: Optional[int] = None


class JobTimelineEntry(BaseModel):
    """One state change from job_status_history, oldest first in the response.

    The timeline is what turns a status field into an explanation: it answers
    "how long did this sit unmatched?" and "was a partner assigned and then
    replaced?" without a second request or database access."""
    status: str
    changed_at: datetime
    note: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class JobDetailResponse(BaseModel):
    """Response for GET /jobs/{job_id}: the core job fields, the newest
    assignment, and the full status timeline. current_assignment is null until
    the dispatch engine offers the job to a partner, which is the signal a
    tracking screen polls on."""
    id: uuid.UUID
    status: str
    service_id: int
    vehicle_number: Optional[str] = None
    pickup_address_text: Optional[str] = None
    issue_description: Optional[str] = None
    price_estimate: Optional[Decimal] = None
    price_final: Optional[Decimal] = None
    requested_at: datetime
    completed_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class AssignmentRespondRequest(BaseModel):
    """Inbound payload for POST /job-assignments/{assignment_id}/respond.

    Literal rather than a free string so an unrecognised action is a 422 naming
    the two valid values, not a silent fall-through to whichever branch the
    service happens to treat as the default. "accept" and "reject" are the only
    two answers a partner can give; letting an offer expire is a different thing
    entirely and is not a client action.

    rejection_reason is optional because requiring one would mean a partner in a
    hurry types anything to get the dialog closed, and a column full of "x" is
    worse than a column full of nulls.
    """
    action: Literal["accept", "reject"]
    rejection_reason: Optional[str] = Field(default=None, max_length=500)


class AssignmentRespondResponse(BaseModel):
    """What the partner app gets back after answering an offer.

    Confirmation, not the job. GET /jobs/{job_id} already owns the job
    representation — including the PII redaction rules about which fields a
    partner may see — and duplicating that shape here would mean two places to
    update the next time a field becomes sensitive, with one of them certain to
    be forgotten. So this returns the state that changed and nothing else.

    next_assignment_id is the offer that was passed to the following partner
    after a rejection. It is null on accept, and also null on a rejection that
    exhausted the candidate pool — in which case job_status will read
    'no_match_found', which is how the two cases are told apart.
    """
    assignment_id: uuid.UUID
    assignment_status: str
    job_id: uuid.UUID
    job_status: str
    responded_at: Optional[datetime] = None
    next_assignment_id: Optional[uuid.UUID] = None


class DispatchAssignmentResponse(BaseModel):
    """One offer, as dispatch created it.

    Carries the audit fields — matching_score, score_components and
    was_baseline_choice — because the point of storing them is that they can be
    read back and argued with. A number with no breakdown is not an explanation.
    """
    id: uuid.UUID
    job_id: uuid.UUID
    partner_id: Optional[uuid.UUID] = None
    status: str
    assignment_rank: Optional[int] = None
    distance_at_offer_m: Optional[Decimal] = None
    matching_score: Optional[Decimal] = None
    score_components: Optional[dict] = None
    was_baseline_choice: Optional[bool] = None
    offered_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

