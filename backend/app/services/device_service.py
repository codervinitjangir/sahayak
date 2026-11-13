"""Device push-token registration rules and transactions (ADR-026)."""
from typing import Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import device_repository
from app.services.auth_service import Identity
from app.utils.errors import ErrorCode, ForbiddenError, InternalError
from app.utils.logging import log_event


def _owner_type(identity: Identity) -> str:
    if identity.role not in ("user", "partner"):
        raise ForbiddenError(ErrorCode.FORBIDDEN, "Only owners and partners register devices.")
    return identity.role


async def register(db: AsyncSession, identity: Identity, token: str, platform: Optional[str]) -> None:
    owner_type = _owner_type(identity)
    try:
        await device_repository.upsert(db, owner_type=owner_type, owner_id=identity.local_id,
                                       token=token, platform=platform)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not register this device") from exc
    # The token is a credential to message this device; it is never logged.
    log_event("push_token_registered", owner_type=owner_type, platform=platform, outcome="success")


async def unregister(db: AsyncSession, identity: Identity, token: str) -> None:
    """Removes the token only if it is the caller's; otherwise a no-op, so a
    sign-out never fails and nobody can unregister someone else's device."""
    owner_type = _owner_type(identity)
    try:
        await device_repository.delete_for_owner(db, owner_type=owner_type, owner_id=identity.local_id, token=token)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not unregister this device") from exc
