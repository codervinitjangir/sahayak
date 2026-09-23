"""
Job endpoints: POST /api/v1/jobs, GET /api/v1/jobs/{job_id},
POST /api/v1/jobs/{job_id}/status and POST /api/v1/jobs/{job_id}/cancel.

The last two are both "end this job" and are deliberately separate routes, one
per role: /status is the partner's, /cancel is the owner's. They differ in who
may call them, which statuses they work from, and what the request body means,
so a single route branching on role would carry two authorisation models at
once. See ADR-013.

Handlers here are intentionally thin: FastAPI validates the request, get_db()
supplies the session, and app/services/job_service.py does the work. Any rule
that could ever be reused outside HTTP (ownership checks, service lookup,
response assembly) belongs in the service, not in this module.

Every response goes through envelope(), so the body is
`{"data": ..., "meta": {"request_id": ...}}`; failures are rendered in the
matching error envelope by app/middlewares/error_handlers.py.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.job import (
    JobCancelRequest,
    JobCancelResponse,
    JobCreateRequest,
    JobDetailResponse,
    JobResponse,
    JobStatusTransitionRequest,
    JobStatusTransitionResponse,
)
from app.services import job_service
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity, require_partner, require_user

# Declared on the router so the OpenAPI document advertises the real error
# envelope. Without this, /docs would still show FastAPI's default
# HTTPValidationError for 422, which register_error_handlers no longer emits.
_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid request"},
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {"model": ErrorResponse, "description": "Token valid, action not permitted"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
    409: {"model": ErrorResponse, "description": "Conflicts with the job's current state"},
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/jobs",
    tags=["jobs"],
    responses=_ERROR_RESPONSES,
)


@router.post(
    "",
    response_model=ApiResponse[JobResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Raise a new assistance job",
)
async def create_job(
    payload: JobCreateRequest,
    identity: Identity = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JobResponse]:
    """Create a job in 'requested' state for the authenticated user's vehicle.

    The owner is taken from the bearer token, never from the body — identity.
    local_id becomes jobs.user_id.

    Returns 401 UNAUTHORIZED without a valid token, 403 FORBIDDEN if the token
    belongs to a partner rather than a vehicle owner, 404 VEHICLE_NOT_FOUND if
    the vehicle does not exist or is not owned by the caller, and 400
    INVALID_SERVICE_CODE if service_code is not a known service.

    Dispatch runs automatically as part of this call, so the returned job is
    usually already in 'matching' with an offer out to one partner — or in
    'no_match_found' if nobody eligible was within the search radius. Both are
    201s: the job was created either way, and 'no_match_found' is an answer the
    driver needs, not a failure to record their request.
    """
    job = await job_service.create_job(db, payload, identity.local_id)
    return envelope(job)


@router.get(
    "/{job_id}",
    response_model=ApiResponse[JobDetailResponse],
    status_code=status.HTTP_200_OK,
    summary="Get a job with its current assignment and timeline",
)
async def get_job(
    job_id: uuid.UUID,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JobDetailResponse]:
    """Return one job, its newest partner assignment and its status timeline.

    current_assignment is null while the job is still waiting to be matched.

    Open to any authenticated identity, but the assigned partner's name, phone,
    rating and id are released only to the job's owner or to that partner
    themselves. Other callers get the same 200 with those fields null — see
    job_service.get_job_with_status for why this is a visibility rule rather
    than a 403.

    Returns 404 JOB_NOT_FOUND for an unknown id, 401 without a valid token.
    """
    detail = await job_service.get_job_with_status(db, job_id, identity)
    return envelope(detail)


@router.post(
    "/{job_id}/status",
    response_model=ApiResponse[JobStatusTransitionResponse],
    status_code=status.HTTP_200_OK,
    summary="Move a job to its next lifecycle status",
)
async def transition_job_status(
    job_id: uuid.UUID,
    payload: JobStatusTransitionRequest,
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JobStatusTransitionResponse]:
    """Advance a job the calling partner is working, or cancel it.

    Partner-only, and only the partner whose job_assignments row for this job
    reads 'accepted' — identity.local_id must match it.

    Legal moves are `assigned → partner_en_route → in_progress → completed`,
    plus `cancelled` from any of those. 'completed' and 'cancelled' are
    terminal. Anything else is 409 INVALID_STATUS_TRANSITION.

    price_final is required on a completion (400 PRICE_FINAL_REQUIRED without
    it) and refused on anything else, as is cancellation_reason outside a
    cancellation (400 FIELD_NOT_APPLICABLE).

    200 rather than 201: this changes an existing job, it does not create a
    resource. The body is the changed state only — call GET /jobs/{job_id} for
    the full job, which is also where the visibility rules for partner contact
    details live.

    Completing or cancelling closes out the assignment as well, which is what
    releases the partner from the job: while a job is in an active status with
    an accepted assignment, it counts against their concurrent-job limit and
    dispatch will stop offering them work once they hit it.

    Returns 401 without a valid token, 403 FORBIDDEN for a user token or a
    partner who is not the one assigned, and 404 JOB_NOT_FOUND for an unknown
    id.
    """
    result = await job_service.transition_job_status(
        db, job_id, payload, identity.local_id
    )
    return envelope(result)


@router.post(
    "/{job_id}/cancel",
    response_model=ApiResponse[JobCancelResponse],
    status_code=status.HTTP_200_OK,
    summary="Cancel your own job",
)
async def cancel_job(
    job_id: uuid.UUID,
    payload: Optional[JobCancelRequest] = None,
    identity: Identity = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JobCancelResponse]:
    """Call off a booking the authenticated owner raised.

    Owner-only, and only the owner of this particular job — identity.local_id
    must match jobs.user_id. A partner token is refused with 403 before the job
    is even read: this is the owner-side counterpart to
    POST /jobs/{job_id}/status, not a shared route, and a mechanic who wants
    off a job uses that one instead. The two have different authorisation
    models and different effects on a partner's record, which is exactly why
    they are not one endpoint.

    Works from any live status, including 'requested' and 'matching' where no
    partner has been found yet — the likeliest moment for a driver to change
    their mind is while they are still watching a spinner, and the partner
    endpoint cannot be reached at all that early.

    409 JOB_ALREADY_TERMINAL if the job is already completed or cancelled.
    Owners cancel active bookings, not finished ones.

    Any outstanding offer or accepted assignment is closed as 'cancelled', not
    'rejected', so a customer's decision never lands on a mechanic's acceptance
    rate. assignment_status in the response says whether a partner was actually
    released; it is null when the job had never been offered.

    200 rather than 201 or 204: this changes an existing job, and the response
    carries the state that changed — call GET /jobs/{job_id} for the full job
    and its timeline.

    Returns 401 without a valid token, 403 for a partner token or someone
    else's job, and 404 JOB_NOT_FOUND for an unknown id.
    """
    # The body is optional because cancelling takes no arguments — a bare POST
    # is the natural client call, and making it a 422 for a missing `{}` would
    # be a papercut on the one route where the request has nothing to say.
    # Normalised here rather than defaulted in the signature so the service
    # always receives a real model and never has to test for None.
    result = await job_service.cancel_job_by_owner(
        db, job_id, payload or JobCancelRequest(), identity.local_id
    )
    return envelope(result)
