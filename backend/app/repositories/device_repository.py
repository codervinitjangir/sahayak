"""SQL for device push tokens (ADR-026). Flush only; the service commits."""
import uuid
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_push_token import DevicePushToken


async def get_by_token(db: AsyncSession, token: str) -> Optional[DevicePushToken]:
    result = await db.execute(select(DevicePushToken).where(DevicePushToken.token == token))
    return result.scalar_one_or_none()


async def upsert(db: AsyncSession, *, owner_type: str, owner_id: uuid.UUID, token: str,
                 platform: Optional[str]) -> DevicePushToken:
    """Bind `token` to this owner. A token is one device; if someone else signed
    in on it last, it moves to the current account so pushes follow the person
    holding the phone."""
    row = await get_by_token(db, token)
    if row is None:
        row = DevicePushToken(owner_type=owner_type, owner_id=owner_id, token=token, platform=platform)
        db.add(row)
    else:
        row.owner_type = owner_type
        row.owner_id = owner_id
        row.platform = platform or row.platform
        row.last_seen_at = func.now()
    await db.flush()
    return row


async def delete_for_owner(db: AsyncSession, *, owner_type: str, owner_id: uuid.UUID, token: str) -> int:
    result = await db.execute(
        delete(DevicePushToken)
        .where(DevicePushToken.token == token)
        .where(DevicePushToken.owner_type == owner_type)
        .where(DevicePushToken.owner_id == owner_id)
    )
    return result.rowcount or 0
