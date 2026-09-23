"""
Data-access layer for vehicle-owner registration.

Same contract as app/repositories/partner_repository.py: everything here only
talks to the database and returns ORM objects, rows or None. It deliberately
does not raise HTTP errors and does not commit — deciding what a missing row
*means*, and where the transaction boundary sits, belongs to
app/services/user_service.py.

Kept separate from app/repositories/auth_repository.py even though both touch
the `users` table. That module exists for one narrow job — resolving a Supabase
`sub` to a local row on every authenticated request — and its lookups are keyed
on auth_user_id. Registration is a different question asked of the same table
("is this person already on the platform?", keyed on phone), and it belongs with
the feature it serves rather than inside the auth join.
"""
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def get_user_by_phone(db: AsyncSession, phone: str) -> Optional[User]:
    """Look up a vehicle owner by phone number, which is unique in the schema.

    Used to answer "is this person already registered?" before attempting an
    insert, so the caller can return a meaningful error instead of letting a
    unique-constraint violation surface. Mirrors
    partner_repository.get_partner_by_phone.
    """
    result = await db.execute(select(User).where(User.phone == phone))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """Look up a vehicle owner by email, which is also unique in the schema.

    Separate from the phone lookup because email is optional at registration:
    there is nothing to check when it was not supplied, and querying for NULL
    would match every row that never provided one.
    """
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user_row(
    db: AsyncSession,
    *,
    name: str,
    phone: str,
    email: Optional[str],
    phone_verified: bool,
    auth_user_id: uuid.UUID,
) -> User:
    """Stage a new users row and flush it so its generated id is available.

    auth_user_id is written in the same INSERT as the rest of the profile rather
    than by a follow-up UPDATE. That is what makes registration a single
    round-trip and, more importantly, atomic: there is no window in which a
    users row exists with no owner, which is exactly the state that would be
    left behind if the link call were separate and the client crashed between
    the two.

    created_at is left to the column default so Postgres, not this process,
    decides what "now" means.
    """
    user = User(
        name=name,
        phone=phone,
        email=email,
        phone_verified=phone_verified,
        auth_user_id=auth_user_id,
    )
    db.add(user)
    await db.flush()
    return user
