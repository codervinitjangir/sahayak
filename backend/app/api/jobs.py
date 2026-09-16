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

# Declared on the router so the OpenAPI document advertises the real error
# envelope. Without this, /docs would still show FastAPI's default
# HTTPValidationError for 422, which register_error_handlers no longer emits.
_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid request"},
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
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JobResponse]:
    """Create a job in 'requested' state for a user's vehicle.

    Returns 404 VEHICLE_NOT_FOUND if the vehicle does not exist or is not owned
    by user_id, and 400 INVALID_SERVICE_CODE if service_code is not a known
    service. Dispatch is not triggered here — the job is left for the matching
    engine to pick up.
    """
    job = await job_service.create_job(db, payload)
    return envelope(job)


@router.get(
    "/{job_id}",
    response_model=ApiResponse[JobDetailResponse],
    status_code=status.HTTP_200_OK,
    summary="Get a job with its current assignment and timeline",
)
async def get_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JobDetailResponse]:
    """Return one job, its newest partner assignment and its status timeline.

    current_assignment is null while the job is still waiting to be matched.
    Returns 404 JOB_NOT_FOUND for an unknown id.
    """
    detail = await job_service.get_job_with_status(db, job_id)
    return envelope(detail)
