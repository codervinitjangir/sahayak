"""Job safeguards from the 2026-11-21 trust and safety pass.

Each rule answers a failure that complaint sites and news reports describe for
roadside and home-service apps (docs/research/2026-11-21-roadside-app-failures.md):

  * ADR-039 the bill grows after the work: a final price above the estimate
    (+10%) needs the owner's approval, asked for in the app, before completion.
  * ADR-041 the partner never turns up: once a job is overdue, the owner can
    ask for another partner without cancelling and starting again.
  * ADR-042 "the tow damaged my car": towing jobs need a before (pickup) and an
    after (drop) photo, in the private bucket, before they can complete.

ADR-040 (the start code only works near the pickup) lives in job_service.start_job,
next to the code check it extends.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import admin_ops_repository, job_repository, service_repository
from app.repositories import job_trust_repository as repo
from app.schemas.job_safeguards import (
    JobPhotoItem,
    JobPhotoViewUrl,
    JobSafeguardsResponse,
    PhotoUploadRequest,
    PhotoUploadTicket,
    PriceRevisionCreate,
    PriceRevisionResponse,
)
from app.services import notification_service
from app.services.auth_service import Identity
from app.utils import storage
from app.utils.errors import (
    AppError,
    BadRequestError,
    ConflictError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
)
from app.utils.logging import log_event

# ADR-039. Small round-ups (a ₹399 job billed ₹420) do not need a round trip to
# the owner; anything beyond 10% does.
FREE_MARGIN = Decimal("0.10")
REVISABLE_STATUSES = ("assigned", "partner_en_route", "in_progress")

# ADR-041. Overdue = accepted + max(2 x ETA, ETA + 20 min, 30 min).
OVERDUE_FLOOR = timedelta(minutes=30)
OVERDUE_GRACE = timedelta(minutes=20)
DEFAULT_ETA_MIN = 30
SWAPPABLE_STATUSES = ("assigned", "partner_en_route")

# ADR-042.
PHOTO_STATUSES = ("partner_en_route", "in_progress")
PHOTO_MAX_BYTES = 5 * 1024 * 1024
PHOTOS_PER_JOB = 12
_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

STAFF_ROLES_WHO_SEE_PHOTOS = ("super_admin", "ops", "support")


# --- shared --------------------------------------------------------------------

def free_limit(estimate) -> Optional[Decimal]:
    if estimate is None:
        return None
    return (Decimal(estimate) * (1 + FREE_MARGIN)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def allowed_max(db: AsyncSession, job) -> Optional[Decimal]:
    """The highest final price the partner may enter without asking again."""
    candidates = [c for c in (free_limit(job.price_estimate), await repo.highest_approved(db, job.id)) if c is not None]
    return max(candidates) if candidates else None


async def _job_or_404(db: AsyncSession, job_id: uuid.UUID, *, lock: bool = False):
    job = await (job_repository.get_job_by_id_for_update(db, job_id) if lock
                 else job_repository.get_job_by_id(db, job_id))
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    return job


async def _assigned_partner_or_403(db: AsyncSession, job, partner_id: uuid.UUID):
    assignment = await job_repository.get_responsible_assignment(db, job.id)
    if assignment is None or assignment.partner_id != partner_id:
        raise ForbiddenError(ErrorCode.FORBIDDEN, "You are not the partner assigned to this job")
    return assignment


async def _viewer_or_404(db: AsyncSession, job, identity: Identity) -> str:
    """'owner', 'partner' or 'staff'; anyone else gets the same 404 as a missing job."""
    if identity.role == "user" and job.user_id == identity.local_id:
        return "owner"
    if identity.role == "admin" and identity.admin_role in STAFF_ROLES_WHO_SEE_PHOTOS:
        return "staff"
    if identity.role == "partner":
        assignment = await job_repository.get_responsible_assignment(db, job.id)
        if assignment is not None and assignment.partner_id == identity.local_id:
            return "partner"
    raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")


async def photos_required(db: AsyncSession, job) -> bool:
    service = await service_repository.get_service_by_id(db, job.service_id)
    return bool(service is not None and getattr(service, "requires_vehicle_equipment", False))


def overdue_at(assignment, job=None) -> Optional[datetime]:
    accepted = getattr(assignment, "accepted_at", None)
    if accepted is None:
        return None
    eta = timedelta(minutes=assignment.estimated_arrival_min or DEFAULT_ETA_MIN)
    # ADR-050: a partner who accepts a booking early is due at the slot, not now.
    slot = getattr(job, "scheduled_for", None) if job is not None else None
    start = max(accepted, slot) if slot is not None else accepted
    return start + max(2 * eta, eta + OVERDUE_GRACE, OVERDUE_FLOOR)


# --- completion gate (called by job_service.transition_job_status under the job lock)

async def check_completion(db: AsyncSession, job, price_final: Decimal) -> None:
    """Refuse a completion the owner has not agreed to, or a tow with no photos.

    Runs inside the transition's transaction, after the row lock, so an owner's
    approval and a completion cannot interleave. A pending revision left open
    when the partner completes within the allowed amount is withdrawn here.
    """
    limit = await allowed_max(db, job)
    if limit is None or Decimal(price_final) > limit:
        raise ConflictError(
            ErrorCode.PRICE_APPROVAL_REQUIRED,
            "This price is above what the owner agreed. Ask the owner to approve the new price first."
            if limit is not None else
            "This job had no estimate. Ask the owner to approve the price before completing.",
        )
    if await photos_required(db, job):
        stages = await repo.confirmed_stages(db, job.id)
        missing = [s for s in ("pickup", "drop") if s not in stages]
        if missing:
            raise ConflictError(
                ErrorCode.JOB_PHOTOS_REQUIRED,
                f"Add a {' and a '.join(missing)} photo of the vehicle before completing a tow.",
            )
    await repo.withdraw_pending(db, job.id)


# --- ADR-039 price revisions ------------------------------------------------------

async def propose_revision(
    db: AsyncSession, job_id: uuid.UUID, payload: PriceRevisionCreate, partner_id: uuid.UUID
) -> PriceRevisionResponse:
    from app.services.job_service import final_price_ceiling

    job = await _job_or_404(db, job_id, lock=True)
    await _assigned_partner_or_403(db, job, partner_id)
    if job.status not in REVISABLE_STATUSES:
        await db.rollback()
        raise ConflictError(ErrorCode.PRICE_REVISION_CLOSED, f"A job that is {job.status} cannot change price")
    free = free_limit(job.price_estimate)
    if free is not None and payload.amount <= free:
        await db.rollback()
        raise BadRequestError(ErrorCode.PRICE_REVISION_NOT_NEEDED,
                              f"Up to {free} needs no approval. Enter it when you complete the job.")
    ceiling = final_price_ceiling(job.price_estimate)
    if payload.amount > ceiling:
        await db.rollback()
        raise BadRequestError(ErrorCode.PRICE_FINAL_OUT_OF_RANGE,
                              f"price exceeds the allowed maximum of {ceiling} for this job")
    try:
        row = await repo.add_revision(db, job_id=job.id, partner_id=partner_id,
                                      amount=payload.amount, reason=payload.reason.strip())
        result = PriceRevisionResponse.model_validate(row)
        if job.user_id is not None:
            await notification_service.notify_event(
                db, recipient_type="user", recipient_id=job.user_id,
                event="price_revision_requested", job_id=job.id)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(ErrorCode.PRICE_REVISION_PENDING,
                            "A price change is already waiting for the owner") from exc
    log_event("price_revision_requested", job_id=str(job_id), partner_id=str(partner_id),
              amount=str(payload.amount), outcome="success")
    return result


async def decide_revision(
    db: AsyncSession, job_id: uuid.UUID, revision_id: uuid.UUID, approve: bool, identity: Identity
) -> PriceRevisionResponse:
    job = await _job_or_404(db, job_id, lock=True)
    if identity.role != "user" or job.user_id != identity.local_id:
        await db.rollback()
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    row = await repo.get_revision(db, job.id, revision_id)
    if row is None:
        await db.rollback()
        raise NotFoundError(ErrorCode.PRICE_REVISION_NOT_FOUND, "Price change not found")
    if row.status != "pending" or job.status not in REVISABLE_STATUSES:
        await db.rollback()
        raise ConflictError(ErrorCode.PRICE_REVISION_CLOSED, "This price change has already been answered")
    status = "approved" if approve else "rejected"
    try:
        await repo.set_revision_status(db, row, status)
        await notification_service.notify_event(
            db, recipient_type="partner", recipient_id=row.partner_id,
            event=f"price_revision_{status}", job_id=job.id)
        result = PriceRevisionResponse.model_validate(row)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not record your answer") from exc
    log_event("price_revision_decided", job_id=str(job_id), revision_id=str(revision_id),
              decision=status, outcome="success")
    return result


# --- read ---------------------------------------------------------------------------

async def get_safeguards(db: AsyncSession, job_id: uuid.UUID, identity: Identity,
                         now: Optional[datetime] = None) -> JobSafeguardsResponse:
    from app.services.job_service import final_price_ceiling

    job = await _job_or_404(db, job_id)
    viewer = await _viewer_or_404(db, job, identity)
    revisions = [PriceRevisionResponse.model_validate(r) for r in await repo.list_revisions(db, job.id)]
    photos = [JobPhotoItem(id=p.id, stage=p.stage, uploaded_at=p.uploaded_at)
              for p in await repo.list_photos(db, job.id)]
    available_at, can_swap = None, False
    if job.status in SWAPPABLE_STATUSES:
        assignment = await job_repository.get_responsible_assignment(db, job.id)
        available_at = overdue_at(assignment, job) if assignment is not None else None
        now = now or datetime.now(timezone.utc)
        can_swap = viewer == "owner" and available_at is not None and now >= available_at
    return JobSafeguardsResponse(
        job_id=job.id, status=job.status, price_estimate=job.price_estimate,
        price_allowed_max=await allowed_max(db, job),
        price_ceiling=final_price_ceiling(job.price_estimate),
        pending_revision=next((r for r in revisions if r.status == "pending"), None),
        revisions=revisions,
        photos_required=await photos_required(db, job),
        photos=photos,
        new_partner_available_at=available_at,
        can_request_new_partner=can_swap,
    )


# --- ADR-041 owner asks for another partner -------------------------------------------

async def request_new_partner(
    db: AsyncSession, job_id: uuid.UUID, identity: Identity, now: Optional[datetime] = None
) -> JobSafeguardsResponse:
    """Release an overdue partner and search again, keeping the same request.

    The same two steps as a staff reassign (ADR-030): the release commits under
    the job lock, then the ordinary re-dispatch runs, which never re-offers a
    partner who already had this job. The released assignment is 'cancelled'
    with a history note naming the reason, so ops can see late partners.
    """
    from app.services import dispatch_service
    from app.utils.errors import DispatchUnavailableError

    job = await _job_or_404(db, job_id, lock=True)
    if identity.role != "user" or job.user_id != identity.local_id:
        await db.rollback()
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    open_assignments = await job_repository.get_open_assignments(db, job.id)
    accepted = next((a for a in open_assignments if a.status == "accepted"), None)
    if job.status not in SWAPPABLE_STATUSES or accepted is None:
        status_now = job.status
        await db.rollback()
        raise ConflictError(ErrorCode.JOB_NOT_REASSIGNABLE,
                            f"A job that is {status_now} cannot be moved to another partner")
    due = overdue_at(accepted, job)
    now = now or datetime.now(timezone.utc)
    if due is None or now < due:
        await db.rollback()
        raise ConflictError(ErrorCode.PARTNER_NOT_OVERDUE,
                            "Your partner is still within their arrival time. You can ask for another after it passes.")
    job_pk, from_status = job.id, job.status
    released = [a.partner_id for a in open_assignments if a.partner_id is not None]
    eta = accepted.estimated_arrival_min
    try:
        for assignment in open_assignments:
            await job_repository.set_assignment_status(db, assignment, "cancelled")
        await job_repository.update_job_fields(db, job, status="matching")
        await job_repository.create_status_history_row(
            db, job_id=job_pk, status="matching",
            note=f"Owner asked for another partner: overdue (ETA {eta or DEFAULT_ETA_MIN} min, from {from_status})")
        for partner_id in released:
            await notification_service.notify_event(
                db, recipient_type="partner", recipient_id=partner_id,
                event="job_reassigned_by_owner", job_id=job_pk)
        await notification_service.notify_event(
            db, recipient_type="user", recipient_id=identity.local_id,
            event="job_reassigning_by_owner", job_id=job_pk)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("owner_new_partner_failed", level=logging.ERROR, job_id=str(job_pk),
                  error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not move the job to another partner") from exc
    log_event("owner_requested_new_partner", job_id=str(job_pk), released=len(released), outcome="success")

    try:
        await db.refresh(job)
        await dispatch_service._offer_next(db, job)
    except DispatchUnavailableError:
        try:
            await dispatch_service.mark_dispatch_unavailable(db, job_pk)
        except Exception:  # noqa: BLE001 - the release already committed
            pass
    except Exception as exc:  # noqa: BLE001 - the release already committed
        await db.rollback()
        log_event("owner_new_partner_dispatch_failed", level=logging.ERROR, job_id=str(job_pk),
                  error_type=type(exc).__name__, outcome="failure")
    return await get_safeguards(db, job_pk, identity, now=now)


# --- ADR-042 towing photos ----------------------------------------------------------

def photo_path(job_id: uuid.UUID, photo_id: uuid.UUID, content_type: str) -> str:
    return f"jobs/{job_id}/{photo_id}.{_EXT[content_type]}"


def _unavailable(exc: Exception) -> AppError:
    log_event("job_photo_storage_unavailable", level=logging.ERROR, error_type=type(exc).__name__)
    return AppError(503, ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE,
                    "Photo storage is not available right now. Try again in a minute.")


async def start_photo_upload(
    db: AsyncSession, job_id: uuid.UUID, partner_id: uuid.UUID, req: PhotoUploadRequest
) -> PhotoUploadTicket:
    job = await _job_or_404(db, job_id)
    await _assigned_partner_or_403(db, job, partner_id)
    if job.status not in PHOTO_STATUSES:
        raise ConflictError(ErrorCode.JOB_ALREADY_TERMINAL if job.status in ("completed", "cancelled")
                            else ErrorCode.INVALID_STATUS_TRANSITION,
                            f"Photos can be added while you are on the way or working, not when the job is {job.status}")
    if len(await repo.list_photos(db, job.id)) >= PHOTOS_PER_JOB:
        raise ConflictError(ErrorCode.FIELD_NOT_APPLICABLE, f"A job can hold at most {PHOTOS_PER_JOB} photos")
    photo_id = uuid.uuid4()
    path = photo_path(job.id, photo_id, req.content_type)
    try:
        url = await storage.signed_upload_url(path)
    except storage.StorageError as exc:
        await db.rollback()
        raise _unavailable(exc) from exc
    await repo.add_photo(db, id=photo_id, job_id=job.id, partner_id=partner_id,
                         stage=req.stage, content_type=req.content_type)
    await db.commit()
    return PhotoUploadTicket(photo_id=photo_id, upload_url=url, max_bytes=PHOTO_MAX_BYTES)


async def confirm_photo(db: AsyncSession, job_id: uuid.UUID, photo_id: uuid.UUID, partner_id: uuid.UUID) -> JobPhotoItem:
    job = await _job_or_404(db, job_id)
    await _assigned_partner_or_403(db, job, partner_id)
    photo = await repo.get_photo(db, job.id, photo_id)
    if photo is None or photo.partner_id != partner_id:
        raise NotFoundError(ErrorCode.JOB_PHOTO_NOT_FOUND, "Photo not found")
    if photo.file_url is None:
        path = photo_path(job.id, photo.id, photo.content_type)
        try:
            info = await storage.object_info(path)
        except storage.StorageError as exc:
            await db.rollback()
            raise _unavailable(exc) from exc
        if info is None:
            raise ConflictError(ErrorCode.JOB_PHOTO_NOT_UPLOADED, "The photo has not been uploaded yet.")
        photo.file_url = path
        photo.uploaded_at = datetime.now(timezone.utc)
        await db.flush()
        await db.commit()
        log_event("job_photo_uploaded", job_id=str(job_id), stage=photo.stage, outcome="success")
    return JobPhotoItem(id=photo.id, stage=photo.stage, uploaded_at=photo.uploaded_at)


async def photo_view_url(db: AsyncSession, job_id: uuid.UUID, photo_id: uuid.UUID, identity: Identity) -> JobPhotoViewUrl:
    """A 60-second link. Owner and assigned partner see their own job; staff views are audited."""
    job = await _job_or_404(db, job_id)
    viewer = await _viewer_or_404(db, job, identity)
    photo = await repo.get_photo(db, job.id, photo_id)
    if photo is None or photo.file_url is None:
        raise NotFoundError(ErrorCode.JOB_PHOTO_NOT_FOUND, "Photo not found")
    path, stage = photo.file_url, photo.stage
    try:
        url = await storage.signed_view_url(path)
    except storage.StorageError as exc:
        await db.rollback()
        raise _unavailable(exc) from exc
    if viewer == "staff":
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="job_photo_viewed", target_type="job",
            target_id=job.id, details={"photo_id": str(photo_id), "stage": stage})
        await db.commit()
    return JobPhotoViewUrl(url=url, expires_in=storage.VIEW_URL_TTL_S)
