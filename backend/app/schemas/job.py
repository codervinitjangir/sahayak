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
    current_assignment: Optional[CurrentAssignmentResponse] = None
    timeline: list[JobTimelineEntry] = Field(default_factory=list)

    # extra="forbid" because these last two fields were missing from this class
    # while job_service.get_job_with_status was already passing them. Pydantic
    # ignores undeclared keyword arguments by default, so the service built the
    # assignment and the timeline on every request and the response model threw
    # both away — silently, with a 200 and no log line. The endpoint's own
    # docstring promised "the signal a tracking screen polls on", and a client
    # polling for it would have waited forever.
    #
    # Forbidding extras turns that class of mistake into an immediate error at
    # the point of construction instead of missing data at the client. Safe
    # here: get_job_with_status is the only caller, and it passes exactly these
    # fields.
    model_config = ConfigDict(from_attributes=True, extra="forbid")


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


class JobStatusTransitionRequest(BaseModel):
    """Inbound payload for POST /jobs/{job_id}/status — a partner moving a job
    they are working through its remaining states.

    Literal rather than a free string, for the same reason as
    AssignmentRespondRequest: an unrecognised status is a 422 naming the four
    valid values, not a database CHECK violation surfaced as a 500. The four
    listed here are the ones a *partner* can reach. 'requested', 'matching',
    'assigned' and 'no_match_found' are all written by the server — dispatch
    owns them — so accepting them here would let a client rewind a job.

    price_final and cancellation_reason are conditionally meaningful rather
    than conditionally valid, which is why neither is enforced here. Pydantic
    can express "required when status == 'completed'" with a model_validator,
    but the resulting failure is a 422 VALIDATION_ERROR, and the specification
    for this endpoint calls for a 400 with a code the client can branch on.
    job_service.transition_job_status owns both checks.
    """
    status: Literal["partner_en_route", "in_progress", "completed", "cancelled"]
    # ge=0 because a negative final price is not a discount, it is a bug. The
    # column is NUMERIC(10,2); Decimal rather than float keeps the value the
    # client sent from acquiring a binary-rounding tail on the way to money.
    price_final: Optional[Decimal] = Field(default=None, ge=0)
    cancellation_reason: Optional[str] = Field(default=None, max_length=500)


class JobStatusTransitionResponse(BaseModel):
    """What a partner gets back after moving a job.

    Confirmation, not the job — the same call AssignmentRespondResponse makes.
    GET /jobs/{job_id} already owns the full job representation *including* the
    rules about which fields each caller may see, and duplicating that shape
    here would mean two places to update the next time a field becomes
    sensitive, with one of them certain to be forgotten.

    It also keeps jobs.user_id out of a partner's hands. JobResponse carries it,
    and while it is only an opaque uuid, it is the owner's primary key — the
    same reasoning that withholds partner_id from non-participants in
    get_job_with_status applies in the other direction.

    assignment_status is here because it is the half of the transition a client
    cannot otherwise see, and on a completion or a cancellation it is the field
    that says the partner has actually been released from the job.
    """
    id: uuid.UUID
    status: str
    assignment_status: Optional[str] = None
    price_final: Optional[Decimal] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class JobCancelRequest(BaseModel):
    """Inbound payload for POST /jobs/{job_id}/cancel — an owner calling off
    their own booking.

    One optional field, and no `status`. That absence is the design: the
    partner's endpoint takes a target status because a partner has four of them
    to choose between, whereas an owner has exactly one thing they can do to a
    live job. Accepting a status here would mean accepting 'completed' as a
    value a customer can post, and no amount of downstream validation is as
    reliable as a field that does not exist.

    The reason is optional for the same reason it is optional on the partner
    side: a mandatory free-text field on a screen someone is tapping through in
    a hurry produces a column full of "x", which is worse than a column full of
    nulls because it looks like data.

    extra="forbid" so a client that sends `{"status": "cancelled"}` — the
    obvious guess if they have only read the other endpoint — gets a 422 naming
    the offending field rather than a silent 200 that ignored it.
    """
    cancellation_reason: Optional[str] = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")


class JobCancelResponse(BaseModel):
    """What the owner's app gets back after cancelling.

    Confirmation, not the job — the same call JobStatusTransitionResponse and
    AssignmentRespondResponse make, so GET /jobs/{job_id} stays the single place
    that owns the job representation and its visibility rules.

    Deliberately *not* a reuse of JobStatusTransitionResponse, despite the
    overlap. That model carries price_final and completed_at, which on a
    cancellation are null by definition; shipping them would invite an owner app
    to render a price field that can never be populated on this path. It also
    exists to describe a *partner's* view, and its docstring reasons about
    withholding jobs.user_id from a partner — reasoning that does not transfer
    to the person who owns the row.

    assignment_status is null when the job was cancelled before anyone had been
    offered it, which is the normal case for a cancel from 'requested'. When it
    reads 'cancelled', a partner was released — and 'cancelled' is the point:
    see ADR-012 on why this must not be recorded as a rejection.
    """
    id: uuid.UUID
    status: str
    assignment_status: Optional[str] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


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

