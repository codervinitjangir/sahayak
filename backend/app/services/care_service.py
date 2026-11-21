"""Sahayak Care memberships, without payments (ADR-051).

A plan is N covered call-outs over a term. Staff grant a membership to an owner
(audited, like every other staff write). A job the owner creates while a call-out
is left is linked to the membership; "used" is counted from those links, so a
cancelled or unmatched job gives its call-out back with no bookkeeping.

What "covered" does NOT do yet: change the price. There is no billing until
payments go live (G3), so the link is recorded and shown, and the price the owner
sees is unchanged. Every client says so next to the badge (PRICING_NOTE).
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.care import CareMembership, CarePlan
from app.repositories import admin_ops_repository, care_repository
from app.schemas.care import (
    AdminUserCareResponse,
    CareMembershipResponse,
    CarePlanResponse,
    MyCareResponse,
)
from app.services.auth_service import Identity
from app.utils.errors import BadRequestError, ConflictError, ErrorCode, InternalError, NotFoundError
from app.utils.logging import log_event

PRICING_NOTE = (
    "Sahayak Care is being trialled. A covered call-out is counted against your plan, "
    "but the price is the same as any other job until membership billing starts."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def is_in_force(m: CareMembership, now: datetime) -> bool:
    return m.revoked_at is None and m.starts_at <= now < m.ends_at


def callouts_left(allowed: int, used: int) -> int:
    return max(0, allowed - used)


async def _view(db: AsyncSession, m: CareMembership, plan: Optional[CarePlan], now: datetime) -> CareMembershipResponse:
    used = await care_repository.count_callouts_used(db, m.id)
    return CareMembershipResponse(
        id=m.id,
        plan_code=plan.code if plan else "",
        plan_name=plan.name if plan else "",
        starts_at=m.starts_at,
        ends_at=m.ends_at,
        callouts_allowed=m.callouts_allowed,
        callouts_used=used,
        callouts_left=callouts_left(m.callouts_allowed, used),
        active=is_in_force(m, now),
        revoked_at=m.revoked_at,
        revoke_reason=m.revoke_reason,
    )


async def my_care(db: AsyncSession, user_id: uuid.UUID) -> MyCareResponse:
    now = _now()
    m = await care_repository.get_current_membership(db, user_id, now)
    plans = await care_repository.list_active_plans(db)
    view = await _view(db, m, await care_repository.get_plan(db, m.plan_id), now) if m else None
    return MyCareResponse(
        membership=view,
        plans=[CarePlanResponse(code=p.code, name=p.name, callouts=p.callouts, term_days=p.term_days) for p in plans],
        pricing_note=PRICING_NOTE,
    )


async def user_care_for_staff(db: AsyncSession, user_id: uuid.UUID) -> AdminUserCareResponse:
    if await admin_ops_repository.get_user(db, user_id) is None:
        raise NotFoundError(ErrorCode.USER_NOT_FOUND, "User not found")
    now = _now()
    history = []
    current = None
    for m in await care_repository.list_memberships_for_user(db, user_id):
        view = await _view(db, m, await care_repository.get_plan(db, m.plan_id), now)
        history.append(view)
        if current is None and view.active:
            current = view
    return AdminUserCareResponse(current=current, history=history)


async def grant(
    db: AsyncSession, user_id: uuid.UUID, *, plan_code: str, reason: str, identity: Identity
) -> AdminUserCareResponse:
    """Start a membership now for the plan's term. 409 if one is already in
    force: extend by revoking and granting again, never by stacking two."""
    user = await admin_ops_repository.get_user_for_update(db, user_id)  # serialises grants per owner
    if user is None:
        await db.rollback()
        raise NotFoundError(ErrorCode.USER_NOT_FOUND, "User not found")
    plan = await care_repository.get_plan_by_code(db, plan_code)
    if plan is None or not plan.is_active:
        await db.rollback()
        raise BadRequestError(ErrorCode.CARE_PLAN_NOT_FOUND, "No such Sahayak Care plan")
    now = _now()
    if await care_repository.get_current_membership(db, user_id, now) is not None:
        await db.rollback()
        raise ConflictError(ErrorCode.CARE_ALREADY_ACTIVE, "This owner already has Sahayak Care")
    ends_at = now + timedelta(days=plan.term_days)
    try:
        m = await care_repository.add_membership(
            db, user_id=user_id, plan_id=plan.id, callouts_allowed=plan.callouts,
            starts_at=now, ends_at=ends_at, granted_by=identity.local_id, grant_reason=reason,
        )
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="care_granted", target_type="user",
            target_id=user_id, reason=reason,
            details={"membership_id": str(m.id), "plan": plan.code, "ends_at": ends_at.isoformat()},
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not grant Sahayak Care") from exc
    log_event("care_granted", user_id=str(user_id), admin_id=str(identity.local_id), plan=plan.code, outcome="success")
    return await user_care_for_staff(db, user_id)


async def revoke(db: AsyncSession, user_id: uuid.UUID, *, reason: str, identity: Identity) -> AdminUserCareResponse:
    """End the membership in force now. Jobs already linked stay linked: they
    were covered when they were raised."""
    user = await admin_ops_repository.get_user_for_update(db, user_id)
    if user is None:
        await db.rollback()
        raise NotFoundError(ErrorCode.USER_NOT_FOUND, "User not found")
    now = _now()
    m = await care_repository.get_current_membership(db, user_id, now, for_update=True)
    if m is None:
        await db.rollback()
        raise ConflictError(ErrorCode.CARE_NOT_ACTIVE, "This owner has no Sahayak Care in force")
    try:
        m.revoked_at = now
        m.revoked_by = identity.local_id
        m.revoke_reason = reason
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="care_revoked", target_type="user",
            target_id=user_id, reason=reason, details={"membership_id": str(m.id)},
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not end Sahayak Care") from exc
    log_event("care_revoked", user_id=str(user_id), admin_id=str(identity.local_id), outcome="success")
    return await user_care_for_staff(db, user_id)


async def membership_for_new_job(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> Optional[uuid.UUID]:
    """Inside create_job's transaction: the membership to link the new job to,
    or None. Locks the membership row, so two jobs raised at once count the
    call-outs one after the other and cannot both take the last one. The lock
    is released by create_job's commit or rollback."""
    m = await care_repository.get_current_membership(db, user_id, now, for_update=True)
    if m is None:
        return None
    used = await care_repository.count_callouts_used(db, m.id)
    return m.id if used < m.callouts_allowed else None
