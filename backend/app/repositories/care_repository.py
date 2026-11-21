"""Sahayak Care (ADR-051). SQL only; flush, never commit."""
import uuid
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.care import CareMembership, CarePlan
from app.models.job import Job

# A linked job uses a call-out while it is open or once it is completed. A
# cancelled or unmatched one gives the call-out back.
RELEASING_STATUSES = ("cancelled", "no_match_found")


async def list_active_plans(db: AsyncSession) -> list[CarePlan]:
    rows = await db.execute(select(CarePlan).where(CarePlan.is_active.is_(True)).order_by(CarePlan.id))
    return list(rows.scalars().all())


async def get_plan_by_code(db: AsyncSession, code: str) -> Optional[CarePlan]:
    rows = await db.execute(select(CarePlan).where(CarePlan.code == code))
    return rows.scalar_one_or_none()


async def get_plan(db: AsyncSession, plan_id: int) -> Optional[CarePlan]:
    return await db.get(CarePlan, plan_id)


def _current(now: datetime):
    return (
        CareMembership.revoked_at.is_(None),
        CareMembership.starts_at <= now,
        CareMembership.ends_at > now,
    )


async def get_current_membership(
    db: AsyncSession, user_id: uuid.UUID, now: datetime, *, for_update: bool = False
) -> Optional[CareMembership]:
    """The owner's membership in force at `now`, if any. `for_update` locks the
    row so concurrent job creations count call-outs one at a time."""
    stmt = (
        select(CareMembership)
        .where(CareMembership.user_id == user_id, *_current(now))
        .order_by(CareMembership.ends_at.desc())
        .limit(1)
    )
    if for_update:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalar_one_or_none()


async def current_membership_ends(
    db: AsyncSession, user_ids: Iterable[uuid.UUID], now: datetime
) -> dict[uuid.UUID, datetime]:
    """user_id -> end of the membership in force, for a page of owners."""
    ids = list(user_ids)
    if not ids:
        return {}
    rows = await db.execute(
        select(CareMembership.user_id, func.max(CareMembership.ends_at))
        .where(CareMembership.user_id.in_(ids), *_current(now))
        .group_by(CareMembership.user_id)
    )
    return {uid: ends for uid, ends in rows.all()}


async def count_callouts_used(db: AsyncSession, membership_id: uuid.UUID) -> int:
    rows = await db.execute(
        select(func.count(Job.id)).where(
            Job.care_membership_id == membership_id,
            Job.status.notin_(RELEASING_STATUSES),
        )
    )
    return int(rows.scalar_one())


async def list_memberships_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[CareMembership]:
    rows = await db.execute(
        select(CareMembership).where(CareMembership.user_id == user_id).order_by(CareMembership.starts_at.desc())
    )
    return list(rows.scalars().all())


async def add_membership(db: AsyncSession, **fields) -> CareMembership:
    row = CareMembership(**fields)
    db.add(row)
    await db.flush()
    return row
