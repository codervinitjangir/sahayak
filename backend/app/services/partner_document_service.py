"""Partner documents: upload, staff review, the verification gate, retention (ADR-038).

Decided by the team on 2026-11-20:
  * every partner: driving licence and a government photo ID;
  * a partner offering a service that needs equipment (towing) also: the tow
    vehicle's RC and a photo of the tow equipment;
  * files live in a private bucket; only ops and super admin may open one, and
    every view is audit-logged;
  * files are kept while the partner account exists and deleted 90 days after
    the partner is rejected (or the account removed).

The partner never gets a file back, only its review status. Staff get a
60-second signed URL per view.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import admin_ops_repository, partner_document_repository as repo
from app.schemas.partner_document import (
    DocumentReviewRequest,
    DocumentUploadRequest,
    DocumentUploadTicket,
    DocumentViewUrl,
    PartnerDocumentItem,
    PartnerDocumentsResponse,
)
from app.services.auth_service import Identity
from app.utils import storage
from app.utils.errors import AppError, BadRequestError, ConflictError, ErrorCode, NotFoundError
from app.utils.logging import log_event

BASE_DOCUMENTS = ("driving_licence", "photo_id")
TOWING_DOCUMENTS = ("tow_vehicle_rc", "tow_equipment_photo")
RETENTION_AFTER_REJECTION = timedelta(days=90)
ABANDONED_UPLOAD_AFTER = timedelta(days=1)
# Remind 14 days ahead, at most once every 20 days per partner.
EXPIRY_REMINDER_BEFORE = timedelta(days=14)
EXPIRY_REMINDER_EVERY = timedelta(days=20)
MAX_BYTES = 5 * 1024 * 1024
_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}


def required_for(does_towing: bool) -> tuple[str, ...]:
    return BASE_DOCUMENTS + (TOWING_DOCUMENTS if does_towing else ())


def object_path(partner_id: uuid.UUID, document_id: uuid.UUID, content_type: str) -> str:
    return f"{partner_id}/{document_id}.{_EXT[content_type]}"


def _unavailable(exc: Exception) -> AppError:
    log_event("document_storage_failed", level=logging.ERROR, error_type=type(exc).__name__,
              detail=str(exc)[:200], outcome="failure")
    return AppError(status_code=503, code=ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE,
                    message="Document storage is unavailable. Please try again shortly.")


def summarise(required: tuple[str, ...], docs) -> PartnerDocumentsResponse:
    """Pure: the partner's checklist from their confirmed documents."""
    by_type = {d.doc_type: d for d in docs}
    items = []
    for t in required:
        d = by_type.get(t)
        items.append(PartnerDocumentItem(doc_type=t, status="missing") if d is None else PartnerDocumentItem(
            doc_type=t, status=d.status, document_id=d.id, rejection_reason=d.rejection_reason,
            expiry_date=d.expiry_date, uploaded_at=d.uploaded_at))
    return PartnerDocumentsResponse(
        required=list(required), documents=items,
        complete=all(i.status == "approved" for i in items),
    )


async def checklist(db: AsyncSession, partner_id: uuid.UUID) -> PartnerDocumentsResponse:
    required = required_for(await repo.partner_does_towing(db, partner_id))
    return summarise(required, await repo.confirmed_documents(db, partner_id))


async def start_upload(db: AsyncSession, partner_id: uuid.UUID, req: DocumentUploadRequest) -> DocumentUploadTicket:
    """Create an unconfirmed row and sign a one-object upload URL for it."""
    if req.doc_type in TOWING_DOCUMENTS and not await repo.partner_does_towing(db, partner_id):
        raise BadRequestError(ErrorCode.DOCUMENT_NOT_REQUIRED,
                              "Tow documents are only needed if you offer towing.")
    if req.doc_type == "tow_vehicle_rc" and not req.reference_number:
        raise BadRequestError("VALIDATION_ERROR", "reference_number: the tow vehicle's registration number is required")

    doc_id = uuid.uuid4()
    path = object_path(partner_id, doc_id, req.content_type)
    try:
        url = await storage.signed_upload_url(path)
    except storage.StorageError as exc:
        await db.rollback()
        raise _unavailable(exc) from exc
    ref = req.reference_number.strip().upper().replace(" ", "") if req.reference_number else None
    await repo.add_document(db, id=doc_id, partner_id=partner_id, doc_type=req.doc_type,
                            content_type=req.content_type, reference_number=ref, status="pending")
    await db.commit()
    return DocumentUploadTicket(document_id=doc_id, upload_url=url, max_bytes=MAX_BYTES)


async def confirm_upload(db: AsyncSession, partner_id: uuid.UUID, document_id: uuid.UUID) -> PartnerDocumentsResponse:
    """The file is in the bucket: make this the partner's document of its type.

    Any earlier document of the same type is replaced (row and file), so a
    rejected licence is re-uploaded by uploading again. Idempotent: confirming
    twice changes nothing.
    """
    doc = await repo.get_document(db, partner_id, document_id, for_update=True)
    if doc is None:
        raise NotFoundError(ErrorCode.DOCUMENT_NOT_FOUND, "Document not found")
    path = object_path(partner_id, doc.id, doc.content_type)
    if doc.file_url is None:
        try:
            info = await storage.object_info(path)
        except storage.StorageError as exc:
            await db.rollback()
            raise _unavailable(exc) from exc
        if info is None:
            await db.rollback()
            raise ConflictError(ErrorCode.DOCUMENT_NOT_UPLOADED, "The file has not been uploaded yet.")
        older = await repo.confirmed_of_type(db, partner_id, doc.doc_type, exclude=doc.id)
        old_paths = [o.file_url for o in older if o.file_url]
        try:
            await repo.delete_rows(db, [o.id for o in older])
            doc.file_url = path
            doc.status = "pending"
            doc.uploaded_at = datetime.now(timezone.utc)
            await db.flush()
            await db.commit()
        except IntegrityError as exc:
            await db.rollback()
            raise ConflictError(ErrorCode.DOCUMENT_NOT_UPLOADED,
                                "Another upload of this document finished first. Refresh and try again.") from exc
        try:
            await storage.delete_objects(old_paths)
        except storage.StorageError:
            # The rows are gone; an orphaned file is logged, not an error for the partner.
            log_event("document_replace_cleanup_failed", level=logging.WARNING,
                      partner_id=str(partner_id), outcome="failure")
        log_event("partner_document_uploaded", partner_id=str(partner_id), doc_type=doc.doc_type,
                  replaced=len(old_paths), outcome="success")
    return await checklist(db, partner_id)


# --- staff ---------------------------------------------------------------------

async def view_url(db: AsyncSession, partner_id: uuid.UUID, document_id: uuid.UUID, identity: Identity) -> DocumentViewUrl:
    """A 60-second link to one file. The view is audited in the same commit."""
    doc = await repo.get_document(db, partner_id, document_id)
    if doc is None or doc.file_url is None:
        raise NotFoundError(ErrorCode.DOCUMENT_NOT_FOUND, "Document not found")
    path, doc_type = doc.file_url, doc.doc_type
    try:
        url = await storage.signed_view_url(path)
    except storage.StorageError as exc:
        await db.rollback()
        raise _unavailable(exc) from exc
    await admin_ops_repository.add_audit(
        db, admin_id=identity.local_id, action="partner_document_viewed", target_type="partner",
        target_id=partner_id, details={"document_id": str(document_id), "doc_type": doc_type},
    )
    await db.commit()
    return DocumentViewUrl(url=url, expires_in=storage.VIEW_URL_TTL_S)


async def review(db: AsyncSession, partner_id: uuid.UUID, document_id: uuid.UUID,
                 req: DocumentReviewRequest, identity: Identity) -> PartnerDocumentsResponse:
    """Approve or reject one document. A rejection needs a reason the partner will see.

    When both tow documents are approved the partner gets a verified
    `tow_vehicle` equipment row (what dispatch checks for towing, ADR-009); a
    rejected tow document marks that row rejected again.
    """
    if req.status == "rejected" and not (req.reason and req.reason.strip()):
        raise BadRequestError("VALIDATION_ERROR", "reason: say why, the partner sees it")
    doc = await repo.get_document(db, partner_id, document_id, for_update=True)
    if doc is None or doc.file_url is None:
        raise NotFoundError(ErrorCode.DOCUMENT_NOT_FOUND, "Document not found")
    now = datetime.now(timezone.utc)
    doc_type, from_status = doc.doc_type, doc.status
    try:
        doc.status = req.status
        doc.rejection_reason = req.reason.strip() if req.status == "rejected" and req.reason else None
        doc.expiry_date = req.expiry_date
        doc.verified_by = identity.local_id
        doc.verified_at = now
        await db.flush()
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action=f"partner_document_{req.status}", target_type="partner",
            target_id=partner_id, reason=req.reason,
            details={"document_id": str(document_id), "doc_type": doc_type, "from_status": from_status},
        )
        if doc_type in TOWING_DOCUMENTS:
            docs = {d.doc_type: d for d in await repo.confirmed_documents(db, partner_id)}
            rc, photo = docs.get("tow_vehicle_rc"), docs.get("tow_equipment_photo")
            both = rc is not None and photo is not None and rc.status == photo.status == "approved"
            await repo.upsert_tow_equipment(
                db, partner_id, rc.reference_number if rc else None,
                "verified" if both else ("rejected" if req.status == "rejected" else "pending"), now)
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        raise
    log_event("partner_document_reviewed", partner_id=str(partner_id), doc_type=doc_type,
              status=req.status, outcome="success")
    return await checklist(db, partner_id)


async def assert_complete_for_verification(db: AsyncSession, partner_id: uuid.UUID) -> None:
    """The verification gate: 409 unless every required document is approved."""
    state = await checklist(db, partner_id)
    if not state.complete:
        missing = [i.doc_type for i in state.documents if i.status != "approved"]
        raise ConflictError(ErrorCode.PARTNER_DOCUMENTS_INCOMPLETE,
                            "Approve every required document first: " + ", ".join(missing))


async def on_verification_change(db: AsyncSession, partner_id: uuid.UUID, to_status: str) -> None:
    """Start or stop the 90-day clock. Staged; the caller commits."""
    if to_status == "rejected":
        await repo.set_retention(db, partner_id, datetime.now(timezone.utc) + RETENTION_AFTER_REJECTION)
    elif to_status == "verified":
        await repo.set_retention(db, partner_id, None)


# --- retention sweep -------------------------------------------------------------

async def sweep_retention(db: AsyncSession, now: Optional[datetime] = None) -> tuple[int, int]:
    """Delete files past retention and abandoned uploads; mark lapsed documents expired.

    Files first, then rows: if the storage delete fails, the rows stay and the
    next sweep tries again, so a file is never left behind without a row that
    points at it. Returns (deleted, expired).
    """
    now = now or datetime.now(timezone.utc)
    due = await repo.due_for_deletion(db, now, now - ABANDONED_UPLOAD_AFTER)
    paths = [d.file_url or object_path(d.partner_id, d.id, d.content_type or "image/jpeg") for d in due]
    ids = [d.id for d in due]
    if ids:
        await storage.delete_objects(paths)
        await repo.delete_rows(db, ids)
    expired_partners = await repo.mark_expired(db, now.date())
    expired = len(expired_partners)
    # ADR-038 amendment (2026-11-21): tell the partner before and when a document lapses.
    from app.services import notification_service
    for partner_id in set(expired_partners):
        await notification_service.notify_partner(db, partner_id, "document_expired")
    due_soon = await repo.partners_to_remind(
        db, now.date(), now.date() + EXPIRY_REMINDER_BEFORE, now - EXPIRY_REMINDER_EVERY)
    for partner_id in due_soon:
        await notification_service.notify_partner(db, partner_id, "document_expiring")
    await db.commit()
    if ids or expired:
        log_event("document_retention_sweep", deleted=len(ids), expired=expired, outcome="success")
    return len(ids), expired
