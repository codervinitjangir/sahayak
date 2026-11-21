"""Scheduled jobs (ADR-050): the owner books a slot instead of asking for help now.

The job is created as 'scheduled' with `scheduled_for` (slot start) and `slot_end`,
and nobody is offered it yet. RELEASE_LEAD before the slot, the dispatch worker
moves it to 'requested' and runs the ordinary dispatch: offers, the 60-second
timeout, wider searches, no_match_found. Nothing about matching is new; only
*when* it starts is.

`requested_at` is reset at release. Every dispatch clock (offer timeout, search
window, orphan expiry, analytics time-to-assign) reads it, and for a job booked a
week ahead "requested" truthfully means "when we started looking". The booking
moment stays in job_status_history (the 'scheduled' row).

Slots are fixed two-hour windows in India time. IST has no daylight saving, so a
fixed +05:30 offset is exact and needs no timezone database on the server.
"""
import logging
import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import job_repository
from app.services import notification_service
from app.utils.errors import BadRequestError, ConflictError, ErrorCode, InternalError, NotFoundError
from app.utils.logging import log_event

IST = timezone(timedelta(hours=5, minutes=30))
SLOT_HOURS = 2
SLOT_STARTS = (8, 10, 12, 14, 16, 18)          # last slot 18:00-20:00
MIN_LEAD = timedelta(hours=2)                  # earliest bookable slot start
MAX_AHEAD = timedelta(days=7)
RELEASE_LEAD = timedelta(minutes=45)           # dispatch starts this long before the slot
MAX_UPCOMING_PER_OWNER = 3


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise BadRequestError(ErrorCode.SLOT_NOT_AVAILABLE, "scheduled_for must include a timezone")
    return dt.astimezone(timezone.utc)


def available_slots(now: datetime) -> list[tuple[datetime, datetime]]:
    """Pure: every bookable (start, end) from now, in UTC, earliest first."""
    out: list[tuple[datetime, datetime]] = []
    local_today = now.astimezone(IST).date()
    for day in range(MAX_AHEAD.days + 1):
        d = local_today + timedelta(days=day)
        for hour in SLOT_STARTS:
            start = datetime.combine(d, time(hour), tzinfo=IST).astimezone(timezone.utc)
            if now + MIN_LEAD <= start <= now + MAX_AHEAD:
                out.append((start, start + timedelta(hours=SLOT_HOURS)))
    return out


def validate_slot(scheduled_for: datetime, now: datetime) -> tuple[datetime, datetime]:
    """Pure: the (start, end) of a bookable slot starting at `scheduled_for`, or 400."""
    start = _as_utc(scheduled_for)
    for s, e in available_slots(now):
        if s == start:
            return s, e
    raise BadRequestError(
        ErrorCode.SLOT_NOT_AVAILABLE,
        "That slot cannot be booked. Pick one of the slots offered (at least 2 hours ahead, within 7 days).")


def slot_label(start: datetime, end: datetime) -> str:
    """'Sun 23 Nov, 10:00-12:00' in India time."""
    s, e = start.astimezone(IST), end.astimezone(IST)
    return f"{s:%a %d %b}, {s:%H:%M}-{e:%H:%M}"


def due_for_release(scheduled_for: datetime, now: datetime) -> bool:
    return scheduled_for - RELEASE_LEAD <= now


async def release_scheduled_job(db: AsyncSession, job_id: uuid.UUID, now: Optional[datetime] = None) -> Optional[str]:
    """Called by the dispatch worker. Returns 'released', 'missed' or None (nothing to do).

    Under the job's row lock, so an owner cancelling or rescheduling at the same
    moment is either seen (and nothing happens) or waits for this to commit.
    A slot that has already ended (the worker was down) is cancelled rather than
    dispatched: a partner turning up hours late to a booking is worse than a
    clear "please book again".
    """
    from app.services import job_service   # job_service imports this module's callers

    now = now or datetime.now(timezone.utc)
    job = await job_repository.get_job_by_id_for_update(db, job_id)
    if job is None or job.status != "scheduled" or job.scheduled_for is None:
        await db.rollback()
        return None
    if not due_for_release(job.scheduled_for, now):
        await db.rollback()
        return None
    owner_id, label = job.user_id, slot_label(job.scheduled_for, job.slot_end)
    try:
        if now >= job.slot_end:
            await job_repository.update_job_fields(
                db, job, status="cancelled", cancelled_at=now,
                cancellation_reason="The booked slot passed before a partner could be found")
            await job_repository.create_status_history_row(
                db, job_id=job_id, status="cancelled", note=f"Slot {label} passed before dispatch started")
            if owner_id is not None:
                await notification_service.notify_event(
                    db, recipient_type="user", recipient_id=owner_id, event="job_expired", job_id=job_id)
            outcome = "missed"
        else:
            await job_repository.update_job_fields(db, job, status="requested", requested_at=now)
            await job_repository.create_status_history_row(
                db, job_id=job_id, status="requested", note=f"Slot {label}: finding a partner")
            if owner_id is not None:
                await notification_service.notify_event(
                    db, recipient_type="user", recipient_id=owner_id, event="scheduled_job_starting", job_id=job_id)
            outcome = "released"
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not release the scheduled job") from exc
    log_event("scheduled_job_released", job_id=str(job_id), outcome=outcome)
    if outcome == "released":
        await db.refresh(job)
        await job_service._try_dispatch(db, job)
    return outcome


async def reschedule(db: AsyncSession, job_id: uuid.UUID, owner_id: uuid.UUID, scheduled_for: datetime,
                     now: Optional[datetime] = None):
    """Move a booking that has not started dispatch to another bookable slot."""
    now = now or datetime.now(timezone.utc)
    start, end = validate_slot(scheduled_for, now)
    job = await job_repository.get_job_by_id_for_update(db, job_id)
    if job is None or job.user_id != owner_id:
        await db.rollback()
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    if job.status != "scheduled":
        status_now = job.status
        await db.rollback()
        raise ConflictError(ErrorCode.JOB_NOT_SCHEDULED,
                            f"This booking is already {status_now}; it can no longer be moved.")
    try:
        await job_repository.update_job_fields(db, job, scheduled_for=start, slot_end=end)
        await job_repository.create_status_history_row(
            db, job_id=job_id, status="scheduled", note=f"Moved to {slot_label(start, end)}")
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not move the booking") from exc
    await db.refresh(job)
    log_event("scheduled_job_moved", job_id=str(job_id), outcome="success", level=logging.INFO)
    return job
