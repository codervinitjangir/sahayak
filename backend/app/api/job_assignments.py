"""
Job assignment endpoints: a partner's answer to an offer.

  POST /api/v1/job-assignments/{assignment_id}/respond

Its own module rather than a route under /jobs, because an assignment is the
partner's side of the transaction and a job is the driver's. They have different
audiences, different auth (require_partner, not the job's owner), and different
lifetimes — a job outlives every offer made for it. Nesting this under
/jobs/{job_id}/... would also force the client to carry a job id it has no other
use for.

Thin, like every other handler here: FastAPI validates, get_db supplies the
session, app/services/dispatch_service.py decides. Responses use the standard
envelope; failures are rendered by app/middlewares/error_handlers.py.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.job import AssignmentRespondRequest, AssignmentRespondResponse
from app.services import dispatch_service
from app.services.auth_service import Identity
from app.utils.auth import require_partner

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid request"},
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {"model": ErrorResponse, "description": "Offer belongs to another partner"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
    409: {
        "model": ErrorResponse,
        "description": "Offer already answered, or the partner is at capacity",
    },
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/job-assignments",
    tags=["job-assignments"],
    responses=_ERROR_RESPONSES,
)


@router.post(
    "/{assignment_id}/respond",
    response_model=ApiResponse[AssignmentRespondResponse],
    status_code=status.HTTP_200_OK,
    summary="Accept or reject a job offer",
)
async def respond_to_assignment(
    assignment_id: uuid.UUID,
    payload: AssignmentRespondRequest,
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AssignmentRespondResponse]:
    """Answer an offer this partner was made.

    On "accept" the offer is accepted and the job moves to 'assigned'. No
    further offers are made for that job.

    On "reject" the offer is marked rejected and dispatch immediately tries the
    next-best partner who has not already been asked, returning that new offer's
    id in next_assignment_id. When nobody is left the job moves to
    'no_match_found' and next_assignment_id is null — job_status is what
    distinguishes that from an acceptance.

    A partner may only answer their own offers: an assignment belonging to
    someone else is refused with 403 FORBIDDEN, which is the same answer an
    unknown-but-someone-else's id gives, so this cannot be used to discover which
    offers exist. An offer that has already been accepted, rejected or timed out
    returns 409 ASSIGNMENT_ALREADY_ANSWERED — this is the common case of a double
    tap on a bad connection, not an unusual one. Returns 404
    ASSIGNMENT_NOT_FOUND for an id that does not exist at all.

    An accept from a partner who is already working the maximum number of
    concurrent jobs returns 409 PARTNER_AT_CAPACITY. The offer is *not* closed —
    being full is not a decline, and it is not counted against the partner's
    acceptance rate — but the job is immediately offered to the next candidate,
    so the driver sees the same thing they would have seen after a rejection. A
    client should treat this as "try again when you have finished something",
    not as an error to report.

    The job itself is not returned. GET /jobs/{job_id} owns that shape, including
    which fields a partner is allowed to see, and duplicating it here would mean
    two copies of the redaction rules with one certain to drift.
    """
    assignment, job, next_assignment = await dispatch_service.respond_to_assignment(
        db,
        assignment_id=assignment_id,
        partner_id=identity.local_id,
        action=payload.action,
        rejection_reason=payload.rejection_reason,
    )
    return envelope(
        AssignmentRespondResponse(
            assignment_id=assignment.id,
            assignment_status=assignment.status,
            job_id=job.id,
            job_status=job.status,
            responded_at=assignment.responded_at,
            next_assignment_id=next_assignment.id if next_assignment else None,
        )
    )
