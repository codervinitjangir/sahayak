"""SQL for staff accounts and invites (ADR-029). Reads and flushes only; the
service owns the transaction. ORM/Core with typed binds throughout, so
asyncpg's PREPARE-before-bind never sees an untyped parameter.
"""
import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import Admin
from app.models.admin_invite import AdminInvite


async def list_admins(db: AsyncSession) -> Sequence[Admin]:
    result = await db.execute(select(Admin).order_by(Admin.created_at, Admin.id))
    return result.scalars().all()


async def get_admin_for_update(db: AsyncSession, admin_id: uuid.UUID) -> Optional[Admin]:
    result = await db.execute(select(Admin).where(Admin.id == admin_id).with_for_update())
    return result.scalar_one_or_none()


async def lock_active_super_admins(db: AsyncSession) -> Sequence[Admin]:
    """Every super admin who can still sign in, row-locked.

    Locked in id order so two concurrent "remove the other super admin" requests
    take the same locks in the same order and serialise instead of deadlocking;
    the second one then sees the first one's change and is refused.
    """
    result = await db.execute(
        select(Admin)
        .where(
            Admin.role == "super_admin",
            Admin.disabled_at.is_(None),
            Admin.auth_user_id.is_not(None),
        )
        .order_by(Admin.id)
        .with_for_update()
    )
    return result.scalars().all()


async def get_active_admin_by_phone_digits(db: AsyncSession, digits: str) -> Optional[Admin]:
    """An admin who is not disabled and whose stored phone has these digits."""
    result = await db.execute(
        select(Admin).where(
            func.regexp_replace(func.coalesce(Admin.phone, ""), r"\D", "", "g") == digits,
            Admin.disabled_at.is_(None),
        )
    )
    return result.scalars().first()


async def add_admin(
    db: AsyncSession, *, name: str, role: str, phone: str,
    auth_user_id: uuid.UUID, invited_by: Optional[uuid.UUID],
) -> Admin:
    row = Admin(name=name, role=role, phone=phone, auth_user_id=auth_user_id, invited_by=invited_by)
    db.add(row)
    await db.flush()
    return row


async def add_invite(
    db: AsyncSession, *, token_hash: str, phone: str, name: str, role: str,
    created_by: Optional[uuid.UUID], expires_at: datetime,
) -> AdminInvite:
    row = AdminInvite(token_hash=token_hash, phone=phone, name=name, role=role,
                      created_by=created_by, expires_at=expires_at)
    db.add(row)
    await db.flush()
    return row


async def get_invite_by_hash_for_update(db: AsyncSession, token_hash: str) -> Optional[AdminInvite]:
    result = await db.execute(
        select(AdminInvite).where(AdminInvite.token_hash == token_hash).with_for_update()
    )
    return result.scalar_one_or_none()


async def get_invite_for_update(db: AsyncSession, invite_id: uuid.UUID) -> Optional[AdminInvite]:
    result = await db.execute(select(AdminInvite).where(AdminInvite.id == invite_id).with_for_update())
    return result.scalar_one_or_none()


async def open_invites(db: AsyncSession, *, phone: Optional[str] = None) -> Sequence[AdminInvite]:
    """Invites neither accepted nor revoked (they may have expired), newest first."""
    stmt = select(AdminInvite).where(AdminInvite.accepted_at.is_(None), AdminInvite.revoked_at.is_(None))
    if phone is not None:
        stmt = stmt.where(AdminInvite.phone == phone).with_for_update()
    result = await db.execute(stmt.order_by(AdminInvite.created_at.desc()))
    return result.scalars().all()
