"""Admin back office: live jobs board, staff cancel, owner suspension, audit (ADR-024).

Every staff write records an admin_audit_log row **in the same transaction** as
the change it describes, the same pairing principle 4 applies to
job_status_history: an action with no audit row is an action nobody can be
asked about, and an audit row for an action that rolled back is a lie.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import admin_ops_repository, job_repository, service_repository
from app.schemas.admin_ops import (
    AdminAlert,
    AdminAlertsResponse,
    AdminAuditEntry,
    AdminAuditListResponse,
    AdminJobItem,
    AdminJobListResponse,
    AdminServiceItem,
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


# ---------------------------------------------------------------------------
# Operational alerts
# ---------------------------------------------------------------------------
# How long a job may sit in one status before a human should look. The search
# window is 10 minutes (ADR-023), so a job still searching after 12 has outlived
# the client that drives it. The others are deliberately generous: an alert
# that fires on ordinary jobs gets ignored.
STUCK_AFTER_MINUTES: dict[str, int] = {
    "requested": 5,
    "matching": 12,
    "no_match_found": 15,
    "assigned": 20,
    "partner_en_route": 90,
    "in_progress": 240,
}
NO_MATCH_WINDOW_MINUTES = 60
NO_MATCH_RATE_THRESHOLD = 0.30
NO_MATCH_MIN_JOBS = 5          # below this a rate is noise, so none is stated
LOW_PARTNERS_ON_DUTY = 3
_MAX_ALERT_JOB_IDS = 20


def evaluate_alerts(
    *,
    now: datetime,
    live_jobs: Sequence[tuple[uuid.UUID, str, datetime, Optional[datetime]]],
    window_counts: dict[str, int],
    partners_on_duty: int,
    partners_verified: int,
) -> AdminAlertsResponse:
    """Pure: turn the three reads into alerts. Tested without a database."""
    alerts: list[AdminAlert] = []

    stuck: list[tuple[datetime, uuid.UUID]] = []
    for job_id, status, requested_at, last_change in live_jobs:
        limit = STUCK_AFTER_MINUTES.get(status)
        since = last_change or requested_at
        if limit is not None and since is not None and now - since > timedelta(minutes=limit):
            stuck.append((since, job_id))
    if stuck:
        stuck.sort()
        alerts.append(AdminAlert(
            code="STUCK_JOBS", severity="critical", count=len(stuck),
            message=(f"{len(stuck)} job(s) have not moved for longer than expected. "
                     "Open the jobs board and call the owner."),
            job_ids=[job_id for _, job_id in stuck[:_MAX_ALERT_JOB_IDS]],
        ))

    jobs_in_window = sum(window_counts.values())
    no_match = window_counts.get("no_match_found", 0)
    rate = (no_match / jobs_in_window) if jobs_in_window >= NO_MATCH_MIN_JOBS else None
    if rate is not None and rate >= NO_MATCH_RATE_THRESHOLD:
        alerts.append(AdminAlert(
            code="HIGH_NO_MATCH_RATE", severity="warning", count=no_match,
            message=(f"{no_match} of {jobs_in_window} requests in the last "
                     f"{NO_MATCH_WINDOW_MINUTES} minutes found no partner."),
        ))

    if partners_on_duty == 0:
        alerts.append(AdminAlert(
            code="NO_PARTNERS_ON_DUTY", severity="critical", count=0,
            message="No verified partner is on duty. Every new request will find nobody.",
        ))
    elif partners_on_duty < LOW_PARTNERS_ON_DUTY:
        alerts.append(AdminAlert(
            code="LOW_PARTNERS_ON_DUTY", severity="warning", count=partners_on_duty,
            message=f"Only {partners_on_duty} verified partner(s) on duty.",
        ))

    return AdminAlertsResponse(
        generated_at=now, alerts=alerts, live_jobs=len(live_jobs),
        partners_on_duty=partners_on_duty, partners_verified=partners_verified,
        window_minutes=NO_MATCH_WINDOW_MINUTES, jobs_in_window=jobs_in_window,
        no_match_in_window=no_match, no_match_rate=round(rate, 3) if rate is not None else None,
    )


async def get_alerts(db: AsyncSession) -> AdminAlertsResponse:
    """Read-only. "On duty" is the availability flag, not a live GPS fix: zone
    coverage lives in Redis and is not judged here."""
    now = datetime.now(timezone.utc)
    live = await admin_ops_repository.live_jobs_with_status_age(
        db, statuses=admin_ops_repository.LIVE_JOB_STATUSES)
    counts = await admin_ops_repository.job_status_counts_since(
        db, now - timedelta(minutes=NO_MATCH_WINDOW_MINUTES))
    on_duty, verified = await admin_ops_repository.partner_duty_counts(db)
    return evaluate_alerts(now=now, live_jobs=live, window_counts=counts,
                           partners_on_duty=on_duty, partners_verified=verified)


# ---------------------------------------------------------------------------
# Catalogue pricing (ADR-028)
# ---------------------------------------------------------------------------
async def set_service_price(
    db: AsyncSession, service_code: str, base_price, reason: str, identity: Identity
) -> AdminServiceItem:
    """Change what new requests for this service are estimated at.

    Jobs already created keep the price_estimate they were given: the estimate
    is stored on the job at creation, so this never rewrites a price an owner
    has already been shown. The change and its audit row commit together.
    """
    from app.services.job_service import base_price_for

    service = await service_repository.get_service_by_code_for_update(db, service_code)
    if service is None:
        raise NotFoundError(ErrorCode.INVALID_SERVICE_CODE, "Service not found")

    previous = base_price_for(service)
    item = AdminServiceItem(id=service.id, code=service.code, name=service.name, base_price=base_price)
    if previous == base_price:
        await db.rollback()          # release the row lock; nothing changed, nothing to audit
        return item
    try:
        service.base_price = base_price
        await db.flush()
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="service_price_changed", target_type="service",
            target_id=None, reason=reason,
            details={"service_code": item.code,
                     "from": str(previous) if previous is not None else None, "to": str(base_price)},
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("admin_service_price_failed", level=logging.ERROR, service_code=item.code,
                  error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not change the price") from exc

    log_event("admin_service_price_changed", service_code=item.code, admin_id=str(identity.local_id),
              outcome="success")
    return item


# ---------------------------------------------------------------------------
# Manual reassign (ADR-030)
# ---------------------------------------------------------------------------
# A partner holds the job (or an unanswered offer) and work has not started.
# 'in_progress' is excluded on purpose: a second mechanic cannot take over a
# half-done repair from a console, and the start code has already been used.
REASSIGNABLE_STATUSES = ("matching", "assigned", "partner_en_route")


async def reassign_job(
    db: AsyncSession, job_id: uuid.UUID, reason: str, identity: Identity
) -> AdminJobItem:
    """Take the job away from whoever holds it and offer it to the next-best partner.

    Two steps, in the order a partner's own decline uses (dispatch_service._reject):

      1. One transaction under the job row lock: every open assignment becomes
         'cancelled' (not 'rejected': the partner did not decline), the job goes
         back to 'matching' with a history row if it had left it, both sides are
         notified, and the audit row is written.
      2. After that commit, the ordinary re-dispatch. It excludes every partner
         who has ever had an assignment for this job, so the released partner is
         never re-offered, and it ends in 'no_match_found' when nobody is left.

    The release is durable before the search starts, so a location-store outage
    cannot leave the old partner holding a job support has taken away.
    """
    from app.services import dispatch_service
    from app.utils.errors import DispatchUnavailableError

    job = await job_repository.get_job_by_id_for_update(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    open_assignments = await job_repository.get_open_assignments(db, job.id)
    if job.status not in REASSIGNABLE_STATUSES or not open_assignments:
        status_now = job.status
        await db.rollback()
        raise ConflictError(
            ErrorCode.JOB_NOT_REASSIGNABLE,
            f"This job is {status_now} with {'no' if not open_assignments else 'a'} partner on it and cannot be reassigned",
        )

    from_status, job_pk = job.status, job.id
    released = [a.partner_id for a in open_assignments if a.partner_id is not None]
    had_accepted_partner = from_status != "matching"
    try:
        for assignment in open_assignments:
            await job_repository.set_assignment_status(
                db, assignment, TERMINAL_ASSIGNMENT_STATUS["cancelled"]
            )
        if had_accepted_partner:
            await job_repository.update_job_fields(db, job, status="matching")
            await job_repository.create_status_history_row(
                db, job_id=job_pk, status="matching", note=f"Reassigned by support: {reason}"
            )
        await notification_service.notify_reassignment(
            db, job=job, released_partner_ids=released, tell_owner=had_accepted_partner
        )
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="job_reassigned", target_type="job",
            target_id=job_pk, reason=reason,
            details={"from_status": from_status, "released_partners": [str(p) for p in released]},
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("admin_job_reassign_failed", level=logging.ERROR, job_id=str(job_pk),
                  error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not reassign the job") from exc

    log_event("admin_job_reassigned", job_id=str(job_pk), admin_id=str(identity.local_id),
              from_status=from_status, released=len(released), outcome="success")

    # Step 2. A failure here must not undo or hide step 1: the job is correctly
    # 'matching' with nobody on it, which the alerts endpoint will flag as stuck.
    try:
        await db.refresh(job)
        await dispatch_service._offer_next(db, job)
    except DispatchUnavailableError:
        log_event("admin_reassign_dispatch_unavailable", level=logging.ERROR, job_id=str(job_pk), outcome="failure")
        try:
            await dispatch_service.mark_dispatch_unavailable(db, job_pk)
        except Exception:  # noqa: BLE001 - the release already committed
            pass
    except Exception as exc:  # noqa: BLE001 - the release already committed
        await db.rollback()
        log_event("admin_reassign_dispatch_failed", level=logging.ERROR, job_id=str(job_pk),
                  error_type=type(exc).__name__, outcome="failure")

    job_row = await job_repository.get_job_by_id(db, job_pk) or job
    try:
        await db.refresh(job_row)      # the re-dispatch may have moved it on
    except SQLAlchemyError:
        pass
    return AdminJobItem(
        id=job_row.id, status=job_row.status, vehicle_number=job_row.vehicle_number,
        pickup_address_text=job_row.pickup_address_text, price_estimate=job_row.price_estimate,
        price_final=job_row.price_final, requested_at=job_row.requested_at,
        completed_at=job_row.completed_at, cancelled_at=job_row.cancelled_at,
    )
