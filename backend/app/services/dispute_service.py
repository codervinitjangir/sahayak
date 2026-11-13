"""Owner "report a problem" and the staff resolution queue (ADR-027).

A refund resolution marks the job's paid payment 'refunded' in the same
transaction as the dispute and the audit row. No money moves here: there is no
gateway, so staff return the money outside the app and this records that they did.
"""
import uuid
from typing import Optional

from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import admin_ops_repository, dispute_repository, job_repository
from app.schemas.dispute import DisputeCreate, DisputeListResponse, DisputeResolve, DisputeResponse
from app.services.auth_service import Identity
from app.utils.errors import ConflictError, ErrorCode, InternalError, NotFoundError
from app.utils.logging import log_event


async def _owned_job(db: AsyncSession, job_id: uuid.UUID, identity: Identity):
    job = await job_repository.get_job_by_id(db, job_id)
    # 404 either way: never confirm a job exists to someone who does not own it.
    if job is None or job.user_id != identity.local_id:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    return job


async def open_dispute(
    db: AsyncSession, job_id: uuid.UUID, payload: DisputeCreate, identity: Identity
) -> DisputeResponse:
    job = await _owned_job(db, job_id, identity)
    if job.status != "completed":
        raise ConflictError(ErrorCode.JOB_NOT_DISPUTABLE, "Only a completed job can be disputed")
    try:
        row = await dispute_repository.create_dispute(
            db, job_id=job.id, user_id=identity.local_id,
            reason=payload.reason, description=payload.description,
        )
        result = DisputeResponse.model_validate(row)
        await db.commit()
    except IntegrityError as exc:
        # The partial unique index allows one open dispute per job.
        await db.rollback()
        raise ConflictError(
            ErrorCode.DISPUTE_ALREADY_OPEN, "A problem report is already open for this job"
        ) from exc
    log_event("dispute_opened", job_id=str(job_id), dispute_id=str(result.id), reason=payload.reason)
    return result


async def list_job_disputes(
    db: AsyncSession, job_id: uuid.UUID, identity: Identity
) -> list[DisputeResponse]:
    await _owned_job(db, job_id, identity)
    rows = await dispute_repository.list_for_job(db, job_id)
    return [DisputeResponse.model_validate(d) for d in rows]


async def list_disputes(
    db: AsyncSession, *, status: Optional[str], limit: int, offset: int
) -> DisputeListResponse:
    rows, total = await dispute_repository.list_disputes(db, status=status, limit=limit, offset=offset)
    return DisputeListResponse(
        items=[DisputeResponse.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


async def resolve_dispute(
    db: AsyncSession, dispute_id: uuid.UUID, payload: DisputeResolve, identity: Identity
) -> DisputeResponse:
    """Close an open dispute. The dispute row is locked so two staff cannot
    both resolve it; the second gets 409 DISPUTE_ALREADY_CLOSED."""
    dispute = await dispute_repository.get_dispute_for_update(db, dispute_id)
    if dispute is None:
        await db.rollback()
        raise NotFoundError(ErrorCode.DISPUTE_NOT_FOUND, "Dispute not found")
    if dispute.status != "open":
        closed_as = dispute.status
        await db.rollback()
        raise ConflictError(ErrorCode.DISPUTE_ALREADY_CLOSED, f"This dispute is already {closed_as}")

    details: dict = {"resolution": payload.resolution}
    if payload.resolution == "refunded":
        payment = await dispute_repository.get_paid_payment_for_update(db, dispute.job_id)
        if payment is None:
            await db.rollback()
            raise ConflictError(ErrorCode.INVALID_PAYMENT_STATE, "This job has no paid payment to refund")
        payment.status = "refunded"
        details["payment_id"] = str(payment.id)
        details["amount"] = str(payment.amount)

    try:
        dispute.status = payload.resolution
        dispute.resolution_note = payload.note
        dispute.resolved_by = identity.local_id
        dispute.resolved_at = datetime.now(timezone.utc)
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action=f"dispute_{payload.resolution}",
            target_type="dispute", target_id=dispute.id, reason=payload.note, details=details,
        )
        await db.flush()
        await db.refresh(dispute)
        result = DisputeResponse.model_validate(dispute)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not resolve the dispute") from exc
    log_event("dispute_resolved", dispute_id=str(dispute_id), resolution=payload.resolution,
              admin_id=str(identity.local_id))
    return result
