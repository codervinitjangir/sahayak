"""Owner problem reports on finished jobs and the staff resolution queue (ADR-027)."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, envelope
from app.schemas.dispute import DisputeCreate, DisputeListResponse, DisputeResolve, DisputeResponse
from app.services import dispute_service
from app.services.auth_service import Identity
from app.utils.auth import require_admin, require_user

router = APIRouter(prefix=f"{API_V1_PREFIX}/jobs", tags=["disputes"])
admin_disputes_router = APIRouter(
    prefix=f"{API_V1_PREFIX}/admin/disputes", tags=["admin back office"]
)


@router.post(
    "/{job_id}/disputes",
    response_model=ApiResponse[DisputeResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Report a problem with a completed job",
)
async def open_dispute(
    job_id: uuid.UUID,
    payload: DisputeCreate,
    identity: Identity = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[DisputeResponse]:
    """409 JOB_NOT_DISPUTABLE before completion; 409 DISPUTE_ALREADY_OPEN for a second open report."""
    return envelope(await dispute_service.open_dispute(db, job_id, payload, identity))


@router.get(
    "/{job_id}/disputes",
    response_model=ApiResponse[list[DisputeResponse]],
    summary="My problem reports for a job",
)
async def list_job_disputes(
    job_id: uuid.UUID,
    identity: Identity = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[DisputeResponse]]:
    return envelope(await dispute_service.list_job_disputes(db, job_id, identity))


@admin_disputes_router.get(
    "", response_model=ApiResponse[DisputeListResponse], summary="Dispute queue"
)
async def admin_list_disputes(
    status_filter: Optional[str] = Query(
        "open", alias="status", pattern="^(open|resolved|rejected|refunded)$"
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    identity: Identity = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[DisputeListResponse]:
    return envelope(await dispute_service.list_disputes(
        db, status=status_filter, limit=limit, offset=offset))


@admin_disputes_router.patch(
    "/{dispute_id}",
    response_model=ApiResponse[DisputeResponse],
    summary="Resolve, reject or refund a dispute (audited)",
)
async def admin_resolve_dispute(
    dispute_id: uuid.UUID,
    payload: DisputeResolve,
    identity: Identity = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[DisputeResponse]:
    """A refund marks the job's paid payment refunded; the money is returned outside the app."""
    return envelope(await dispute_service.resolve_dispute(db, dispute_id, payload, identity))
