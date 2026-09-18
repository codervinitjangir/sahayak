"""
Data-access layer for the Supabase Auth ↔ local identity join.

Same contract as the other repositories in this package: SQL in, ORM rows or
None out. No HTTP errors, no commits — deciding what "this auth id matches no
row" *means*, and where the transaction boundary sits, belongs to
app/services/auth_service.py.

The two lookups are kept as separate functions rather than one UNION query on
purpose. They run on every authenticated request, both are single-row index
hits on auth_user_id, and the service needs to know which table matched in
order to name the role — a UNION would have to carry a literal discriminator
column and would be harder to read for no measurable gain.
"""
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.partner import Partner
from app.models.user import User


async def get_user_by_auth_id(
    db: AsyncSession, auth_user_id: uuid.UUID
) -> Optional[User]:
    """Find the vehicle owner behind a Supabase `sub`, if there is one."""
    result = await db.execute(select(User).where(User.auth_user_id == auth_user_id))
    return result.scalar_one_or_none()


async def get_partner_by_auth_id(
    db: AsyncSession, auth_user_id: uuid.UUID
) -> Optional[Partner]:
    """Find the mechanic behind a Supabase `sub`, if there is one."""
    result = await db.execute(
        select(Partner).where(Partner.auth_user_id == auth_user_id)
    )
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
    """Load a user row by primary key, for the link-auth target check."""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def set_user_auth_id(
    db: AsyncSession, user: User, auth_user_id: uuid.UUID
) -> User:
    """Attach a Supabase account to a user row.

    Whether this is *allowed* is the service's call — this only performs it.
    """
    user.auth_user_id = auth_user_id
    await db.flush()
    return user


async def set_partner_auth_id(
    db: AsyncSession, partner: Partner, auth_user_id: uuid.UUID
) -> Partner:
    """Attach a Supabase account to a partner row."""
    partner.auth_user_id = auth_user_id
    await db.flush()
    return partner
