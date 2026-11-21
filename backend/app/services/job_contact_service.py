"""Owner and partner reaching each other during a job, at no per-use cost.

ADR-057: the owner's live location, shared only with the partner who accepted.
ADR-058: in-app chat between the same two people.

Both follow ADR-017: nothing is released to an offered partner, and the job must
be in an active state for anything new to flow.
"""
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_client import get_redis
from app.repositories import job_message_repository, job_repository
from app.schemas.job_contact import (
    JobMessageItem,
    JobMessageListResponse,
    OwnerLocationResponse,
    OwnerLocationUpdate,
)
from app.services.auth_service import Identity
from app.utils.errors import ConflictError, ErrorCode, NotFoundError
from app.utils.logging import log_event

ACTIVE_STATUSES = ("assigned", "partner_en_route", "in_progress")
OWNER_LOCATION_TTL_S = 120
# A second message from the same person within this window does not push again.
MESSAGE_PUSH_QUIET_S = 120


def owner_location_key(job_id: uuid.UUID) -> str:
    return f"job:{job_id}:owner_location"


async def _job_or_404(db: AsyncSession, job_id: uuid.UUID):
    job = await job_repository.get_job_by_id(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    return job


async def _party_or_404(db: AsyncSession, job, identity: Identity) -> tuple[str, Optional[uuid.UUID]]:
    """('owner', partner_id) or ('partner', partner_id). Anyone else: the same 404
    as a missing job (principle 6). An offered partner is not a party (ADR-017)."""
    assignment = await job_repository.get_responsible_assignment(db, job.id)
    partner_id = assignment.partner_id if assignment is not None else None
    if identity.role == "user" and job.user_id == identity.local_id:
        return "owner", partner_id
    if identity.role == "partner" and partner_id is not None and partner_id == identity.local_id:
        return "partner", partner_id
    raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")


# ─── Owner live location (ADR-057) ──────────────────────────────────────────────

async def share_owner_location(db: AsyncSession, job_id: uuid.UUID, payload: OwnerLocationUpdate,
                               identity: Identity) -> OwnerLocationResponse:
    job = await _job_or_404(db, job_id)
    if job.user_id != identity.local_id:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")
    if job.status not in ACTIVE_STATUSES:
        raise ConflictError(ErrorCode.JOB_NOT_ACTIVE, "Location is shared only while a partner is on the job.")
    now = datetime.now(timezone.utc)
    value = {"lat": payload.lat, "lng": payload.lng, "accuracy_m": payload.accuracy_m, "updated_at": now.isoformat()}
    # Principle 2: volatile, Redis only, gone two minutes after the last fix.
    await get_redis().set(owner_location_key(job.id), json.dumps(value), ex=OWNER_LOCATION_TTL_S)
    return OwnerLocationResponse(lat=payload.lat, lng=payload.lng, accuracy_m=payload.accuracy_m,
                                 updated_at=now, sharing=True)


async def get_owner_location(db: AsyncSession, job_id: uuid.UUID, identity: Identity) -> OwnerLocationResponse:
    job = await _job_or_404(db, job_id)
    await _party_or_404(db, job, identity)
    if job.status not in ACTIVE_STATUSES:
        # Once the job ends, nothing more is released, even from a warm key.
        return OwnerLocationResponse(sharing=False)
    raw = await get_redis().get(owner_location_key(job.id))
    if not raw:
        return OwnerLocationResponse(sharing=False)
    v = json.loads(raw)
    return OwnerLocationResponse(lat=v["lat"], lng=v["lng"], accuracy_m=v.get("accuracy_m"),
                                 updated_at=datetime.fromisoformat(v["updated_at"]), sharing=True)


async def forget_owner_location(job_id: uuid.UUID) -> None:
    """Called when a job ends; the TTL would clear it anyway."""
    try:
        await get_redis().delete(owner_location_key(job_id))
    except Exception:  # pragma: no cover - best effort
        pass


# ─── Chat (ADR-058) ────────────────────────────────────────────────────────────

def _item(row, viewer: str) -> JobMessageItem:
    sender = "owner" if row.sender_type == "user" else "partner"
    return JobMessageItem(id=row.id, sender=sender, mine=(sender == viewer), body=row.body, created_at=row.created_at)


async def list_messages(db: AsyncSession, job_id: uuid.UUID, identity: Identity,
                        after: Optional[datetime] = None) -> JobMessageListResponse:
    job = await _job_or_404(db, job_id)
    viewer, _ = await _party_or_404(db, job, identity)
    rows = await job_message_repository.list_messages(db, job.id, after)
    return JobMessageListResponse(items=[_item(r, viewer) for r in rows],
                                  can_send=job.status in ACTIVE_STATUSES)


async def send_message(db: AsyncSession, job_id: uuid.UUID, body: str, identity: Identity) -> JobMessageItem:
    from app.services import notification_service

    job = await _job_or_404(db, job_id)
    viewer, partner_id = await _party_or_404(db, job, identity)
    if job.status not in ACTIVE_STATUSES:
        raise ConflictError(ErrorCode.JOB_NOT_ACTIVE, "Messages can be sent only while a partner is on the job.")
    sender_type = "user" if viewer == "owner" else "partner"
    previous = await job_message_repository.last_message(db, job.id)
    row = await job_message_repository.add_message(
        db, job_id=job.id, sender_type=sender_type, sender_id=identity.local_id, body=body
    )
    quiet = (
        previous is not None
        and previous.sender_type == sender_type
        and row.created_at - previous.created_at < timedelta(seconds=MESSAGE_PUSH_QUIET_S)
    )
    if not quiet:
        if viewer == "owner" and partner_id is not None:
            await notification_service.notify_event(
                db, recipient_type="partner", recipient_id=partner_id, event="new_message", job_id=job.id)
        elif viewer == "partner":
            await notification_service.notify_event(
                db, recipient_type="user", recipient_id=job.user_id, event="new_message", job_id=job.id)
    item = _item(row, viewer)
    await db.commit()
    log_event("job_message_sent", level=logging.INFO, actor_role=viewer, outcome="success", pushed=not quiet)
    return item
