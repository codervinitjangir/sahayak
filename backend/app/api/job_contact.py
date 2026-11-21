"""Owner live location (ADR-057) and job chat (ADR-058). Thin handlers only."""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, envelope
from app.schemas.job_contact import (
    JobMessageCreate,
    JobMessageItem,
    JobMessageListResponse,
    OwnerLocationResponse,
    OwnerLocationUpdate,
)
from app.services import job_contact_service as svc
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity, require_user

router = APIRouter(prefix=f"{API_V1_PREFIX}/jobs", tags=["job contact"])


@router.put("/{job_id}/owner-location", response_model=ApiResponse[OwnerLocationResponse],
            summary="Owner shares a live fix with the accepted partner")
async def share_owner_location(job_id: uuid.UUID, payload: OwnerLocationUpdate,
                               identity: Identity = Depends(require_user),
                               db: AsyncSession = Depends(get_db)) -> ApiResponse[OwnerLocationResponse]:
    """409 JOB_NOT_ACTIVE unless the job is assigned, partner_en_route or in_progress."""
    return envelope(await svc.share_owner_location(db, job_id, payload, identity))


@router.get("/{job_id}/owner-location", response_model=ApiResponse[OwnerLocationResponse],
            summary="The owner's last live fix (owner or accepted partner)")
async def get_owner_location(job_id: uuid.UUID, identity: Identity = Depends(get_current_identity),
                             db: AsyncSession = Depends(get_db)) -> ApiResponse[OwnerLocationResponse]:
    """An offered partner, or anyone else, gets 404 (ADR-017)."""
    return envelope(await svc.get_owner_location(db, job_id, identity))


@router.get("/{job_id}/messages", response_model=ApiResponse[JobMessageListResponse],
            summary="Chat thread for a job (owner or accepted partner)")
async def list_messages(job_id: uuid.UUID, after: Optional[datetime] = Query(None),
                        identity: Identity = Depends(get_current_identity),
                        db: AsyncSession = Depends(get_db)) -> ApiResponse[JobMessageListResponse]:
    return envelope(await svc.list_messages(db, job_id, identity, after))


@router.post("/{job_id}/messages", response_model=ApiResponse[JobMessageItem],
             status_code=status.HTTP_201_CREATED, summary="Send a chat message")
async def send_message(job_id: uuid.UUID, payload: JobMessageCreate,
                       identity: Identity = Depends(get_current_identity),
                       db: AsyncSession = Depends(get_db)) -> ApiResponse[JobMessageItem]:
    """409 JOB_NOT_ACTIVE once the job has ended."""
    return envelope(await svc.send_message(db, job_id, payload.body, identity))
