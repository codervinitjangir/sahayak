"""
Job endpoints: POST /api/v1/jobs and GET /api/v1/jobs/{job_id}.

Handlers here are intentionally thin: FastAPI validates the request, get_db()
supplies the session, and app/services/job_service.py does the work. Any rule
that could ever be reused outside HTTP (ownership checks, service lookup,
response assembly) belongs in the service, not in this module.

Every response goes through envelope(), so the body is
`{"data": ..., "meta": {"request_id": ...}}`; failures are rendered in the
matching error envelope by app/middlewares/error_handlers.py.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.job import JobCreateRequest, JobDetailResponse, JobResponse
from app.services import job_service
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity, require_user

# Declared on the router so the OpenAPI document advertises the real error
# envelope. Without this, /docs would still show FastAPI's default
# HTTPValidationError for 422, which register_error_handlers no longer emits.
_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid request"},
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {"model": ErrorResponse, "description": "Token valid, action not permitted"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
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
