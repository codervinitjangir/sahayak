"""Job safeguards (ADR-039 to ADR-042): extra-charge approval, a new partner when
the first is overdue, and towing before/after photos. Thin handlers only."""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, envelope
from app.schemas.job_safeguards import (
    JobPhotoItem,
    JobPhotoViewUrl,
    JobSafeguardsResponse,
    PhotoUploadRequest,
    PhotoUploadTicket,
    PriceRevisionCreate,
    PriceRevisionDecision,
    PriceRevisionResponse,
)
from app.services import job_safeguard_service as svc
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity, require_partner, require_user

router = APIRouter(prefix=f"{API_V1_PREFIX}/jobs", tags=["job safeguards"])


@router.get("/{job_id}/safeguards", response_model=ApiResponse[JobSafeguardsResponse],
            summary="Price approvals, towing photos and the new-partner option for a job")
async def get_safeguards(job_id: uuid.UUID, identity: Identity = Depends(get_current_identity),
                         db: AsyncSession = Depends(get_db)) -> ApiResponse[JobSafeguardsResponse]:
    """Owner, assigned partner, or staff (ops/support/super). Anyone else: 404."""
    return envelope(await svc.get_safeguards(db, job_id, identity))


@router.post("/{job_id}/price-revisions", response_model=ApiResponse[PriceRevisionResponse],
             status_code=status.HTTP_201_CREATED, summary="Partner asks the owner to approve a higher price")
async def propose_revision(job_id: uuid.UUID, payload: PriceRevisionCreate,
                           identity: Identity = Depends(require_partner),
                           db: AsyncSession = Depends(get_db)) -> ApiResponse[PriceRevisionResponse]:
    """400 PRICE_REVISION_NOT_NEEDED within estimate + 10%; 400 PRICE_FINAL_OUT_OF_RANGE above the
    hard ceiling; 409 PRICE_REVISION_PENDING if one is already waiting; 409 PRICE_REVISION_CLOSED."""
    return envelope(await svc.propose_revision(db, job_id, payload, identity.local_id))


@router.post("/{job_id}/price-revisions/{revision_id}/decision",
             response_model=ApiResponse[PriceRevisionResponse], summary="Owner approves or rejects a price change")
async def decide_revision(job_id: uuid.UUID, revision_id: uuid.UUID, payload: PriceRevisionDecision,
                          identity: Identity = Depends(require_user),
                          db: AsyncSession = Depends(get_db)) -> ApiResponse[PriceRevisionResponse]:
    return envelope(await svc.decide_revision(db, job_id, revision_id, payload.approve, identity))


@router.post("/{job_id}/request-new-partner", response_model=ApiResponse[JobSafeguardsResponse],
             summary="Owner releases an overdue partner and searches again")
async def request_new_partner(job_id: uuid.UUID, identity: Identity = Depends(require_user),
                              db: AsyncSession = Depends(get_db)) -> ApiResponse[JobSafeguardsResponse]:
    """409 PARTNER_NOT_OVERDUE before new_partner_available_at; 409 JOB_NOT_REASSIGNABLE once work started."""
    return envelope(await svc.request_new_partner(db, job_id, identity))


@router.post("/{job_id}/photos", response_model=ApiResponse[PhotoUploadTicket],
             status_code=status.HTTP_201_CREATED, summary="Partner starts a vehicle photo upload")
async def start_photo_upload(job_id: uuid.UUID, payload: PhotoUploadRequest,
                             identity: Identity = Depends(require_partner),
                             db: AsyncSession = Depends(get_db)) -> ApiResponse[PhotoUploadTicket]:
    """PUT the file to upload_url, then call .../confirm."""
    return envelope(await svc.start_photo_upload(db, job_id, identity.local_id, payload))


@router.post("/{job_id}/photos/{photo_id}/confirm", response_model=ApiResponse[JobPhotoItem],
             summary="Partner confirms an uploaded vehicle photo")
async def confirm_photo(job_id: uuid.UUID, photo_id: uuid.UUID, identity: Identity = Depends(require_partner),
                        db: AsyncSession = Depends(get_db)) -> ApiResponse[JobPhotoItem]:
    return envelope(await svc.confirm_photo(db, job_id, photo_id, identity.local_id))


@router.get("/{job_id}/photos/{photo_id}/url", response_model=ApiResponse[JobPhotoViewUrl],
            summary="A 60-second link to one vehicle photo")
async def photo_view_url(job_id: uuid.UUID, photo_id: uuid.UUID, identity: Identity = Depends(get_current_identity),
                         db: AsyncSession = Depends(get_db)) -> ApiResponse[JobPhotoViewUrl]:
    return envelope(await svc.photo_view_url(db, job_id, photo_id, identity))
