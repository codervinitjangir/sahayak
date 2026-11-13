"""Admin back office: live jobs board, staff cancel, owner suspension, audit (ADR-024).

Every staff write records an admin_audit_log row **in the same transaction** as
the change it describes, the same pairing principle 4 applies to
job_status_history: an action with no audit row is an action nobody can be
asked about, and an audit row for an action that rolled back is a lie.
"""
import logging
import uuid
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import admin_ops_repository, job_repository
from app.schemas.admin_ops import (
    AdminAuditEntry,
    AdminAuditListResponse,
    AdminJobItem,
    AdminJobListResponse,
    AdminUserItem,
    AdminUserListResponse,
)
from app.services import notification_service
from app.services.auth_service import Identity
from app.services.job_service import TERMINAL_ASSIGNMENT_STATUS, TERMINAL_JOB_STATUSES
from app.utils.errors import BadRequestError, ConflictError, ErrorCode, InternalError, NotFoundError
from app.utils.logging import log_event

ALL_JOB_STATUSES = admin_ops_repository.LIVE_JOB_STATUSES + ("completed", "cancelled")


async def list_jobs(
    db: AsyncSession, *, status: Optional[str], q: Optional[str], limit: int, offset: int
) -> AdminJobListResponse:
    """The live board. `status` is one job status, "live" (default) or "all"."""
    if status in (None, "", "live"):
        statuses = admin_ops_repository.LIVE_JOB_STATUSES
    elif status == "all":
        statuses = ALL_JOB_STATUSES
    elif status in ALL_JOB_STATUSES:
        statuses = (status,)
    else:
        raise BadRequestError("VALIDATION_ERROR", f"Unknown status filter '{status}'")

    rows, total = await admin_ops_repository.list_jobs(
        db, statuses=statuses, q=q, limit=limit, offset=offset
    )
    partners = await admin_ops_repository.partners_for_jobs(db, [job.id for job, *_ in rows])
    items = []
    for job, owner_name, owner_phone, service_name in rows:
        a_status, p_name, p_phone = partners.get(job.id, (None, None, None))
        items.append(
            AdminJobItem(
                id=job.id,
                status=job.status,
                service_name=service_name,
                vehicle_number=job.vehicle_number,
                pickup_address_text=job.pickup_address_text,
                owner_name=owner_name,
                owner_phone=owner_phone,
                partner_name=p_name,
                partner_phone=p_phone,
                assignment_status=a_status,
                price_estimate=job.price_estimate,
                price_final=job.price_final,
                requested_at=job.requested_at,
                completed_at=job.completed_at,
                cancelled_at=job.cancelled_at,
            )
        )
    return AdminJobListResponse(items=items, total=total, limit=limit, offset=offset)


async def cancel_job(
    db: AsyncSession, job_id: uuid.UUID, reason: str, identity: Identity
) -> AdminJobItem:
    """Staff cancel. Same rules and locking as cancel_job_by_owner (ADR-013):
    row lock first, refuse finished jobs, close every open assignment as
    'cancelled' (never 'rejected' — the partner did not decline), history row,
    notifications to owner and partners, and the audit row, all in one commit."""
    job = await job_repository.get_job_by_id_for_update(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    if job.status in TERMINAL_JOB_STATUSES:
        raise ConflictError(
            ErrorCode.JOB_ALREADY_TERMINAL,
            f"This job is already {job.status} and cannot be cancelled",
        )

    from_status = job.status
    job_pk = job.id
    open_assignments = await job_repository.get_open_assignments(db, job.id)
    partner_ids = [a.partner_id for a in open_assignments]
    try:
        await job_repository.update_job_fields(
            db, job, status="cancelled", cancelled_at=func.now(),
            cancellation_reason=f"Support: {reason}",
        )
        for assignment in open_assignments:
            await job_repository.set_assignment_status(
                db, assignment, TERMINAL_ASSIGNMENT_STATUS["cancelled"]
            )
        await job_repository.create_status_history_row(
            db, job_id=job_pk, status="cancelled", note=f"Cancelled by support: {reason}"
        )
        await notification_service.notify_job_status_change(
            db, job=job, status="cancelled", actor_role="admin", partner_ids=partner_ids,
        )
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="job_cancelled", target_type="job",
            target_id=job_pk, reason=reason,
            details={"from_status": from_status, "assignments_released": len(open_assignments)},
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("admin_job_cancel_failed", level=logging.ERROR, job_id=str(job_pk),
                  error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not cancel the job") from exc

    log_event("admin_job_cancelled", job_id=str(job_pk), admin_id=str(identity.local_id),
              from_status=from_status, assignments_released=len(open_assignments), outcome="success")
    await db.refresh(job)
    return AdminJobItem(
        id=job.id, status=job.status, vehicle_number=job.vehicle_number,
        pickup_address_text=job.pickup_address_text, price_estimate=job.price_estimate,
        price_final=job.price_final, requested_at=job.requested_at,
        completed_at=job.completed_at, cancelled_at=job.cancelled_at,
    )


def _user_item(user, job_count: int) -> AdminUserItem:
    return AdminUserItem(
        id=user.id, name=user.name, phone=user.phone, email=user.email,
        created_at=user.created_at, job_count=job_count,
        suspended_at=user.suspended_at, suspension_reason=user.suspension_reason,
        has_login=user.auth_user_id is not None,
    )


async def list_users(
    db: AsyncSession, *, q: Optional[str], limit: int, offset: int
) -> AdminUserListResponse:
    rows, total = await admin_ops_repository.list_users(db, q=q, limit=limit, offset=offset)
    return AdminUserListResponse(
        items=[_user_item(u, n) for u, n in rows], total=total, limit=limit, offset=offset
    )


async def set_user_suspension(
    db: AsyncSession, user_id: uuid.UUID, *, suspended: bool, reason: Optional[str], identity: Identity
) -> AdminUserItem:
    """Suspend or reinstate an owner. Idempotent: repeating the current state
    changes nothing and writes no audit row (nothing happened)."""
    user = await admin_ops_repository.get_user_for_update(db, user_id)
    if user is None:
        raise NotFoundError(ErrorCode.USER_NOT_FOUND, "User not found")

    already = user.suspended_at is not None
    if already != suspended:
        try:
            user.suspended_at = func.now() if suspended else None
            user.suspension_reason = reason if suspended else None
            await admin_ops_repository.add_audit(
                db, admin_id=identity.local_id,
                action="user_suspended" if suspended else "user_reinstated",
                target_type="user", target_id=user.id, reason=reason,
            )
            await db.commit()
        except SQLAlchemyError as exc:
            await db.rollback()
            raise InternalError("Could not update the account") from exc
        log_event("admin_user_suspension_changed", user_id=str(user_id),
                  admin_id=str(identity.local_id), suspended=suspended, outcome="success")
    else:
        await db.rollback()  # release the row lock

    user = await admin_ops_repository.get_user(db, user_id)
    return _user_item(user, await admin_ops_repository.count_jobs_for_user(db, user_id))


async def record_partner_verification(
    db: AsyncSession, partner_id: uuid.UUID, *, from_status: str, to_status: str,
    note: Optional[str], identity: Identity,
) -> None:
    """Stage the audit row for a partner verification change. Caller commits."""
    if from_status == to_status:
        return
    await admin_ops_repository.add_audit(
        db, admin_id=identity.local_id, action=f"partner_{to_status}", target_type="partner",
        target_id=partner_id, reason=note, details={"from_status": from_status},
    )


async def list_audit(
    db: AsyncSession, *, target_type: Optional[str], target_id: Optional[uuid.UUID], limit: int, offset: int
) -> AdminAuditListResponse:
    rows, total = await admin_ops_repository.list_audit(
        db, target_type=target_type, target_id=target_id, limit=limit, offset=offset
    )
    return AdminAuditListResponse(
        items=[
            AdminAuditEntry(
                id=r.id, admin_id=r.admin_id, action=r.action, target_type=r.target_type,
                target_id=r.target_id, reason=r.reason, details=r.details, created_at=r.created_at,
            )
            for r in rows
        ],
        total=total, limit=limit, offset=offset,
    )
