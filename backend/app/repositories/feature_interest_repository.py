"""SQL for feature interest (ADR-035). Flush only; the service commits.

`side` is "user" or "partner" and picks the owning column; the service decides
it from the verified identity, never from the request."""
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature_interest import FeatureInterest

_COLUMN = {"user": "user_id", "partner": "partner_id"}
_CONSTRAINT = {"user": "uq_feature_interest_user_feature", "partner": "uq_feature_interest_partner_feature"}


async def add(db: AsyncSession, *, side: str, owner_id: uuid.UUID, feature: str) -> None:
    """Insert, or do nothing if already asked. ON CONFLICT keeps a double tap
    from racing into a unique-violation 500."""
    await db.execute(
        insert(FeatureInterest)
        .values(id=uuid.uuid4(), feature=feature, **{_COLUMN[side]: owner_id})
        .on_conflict_do_nothing(constraint=_CONSTRAINT[side])
    )
    await db.flush()


async def list_for(db: AsyncSession, *, side: str, owner_id: uuid.UUID) -> list[str]:
    column = getattr(FeatureInterest, _COLUMN[side])
    result = await db.execute(
        select(FeatureInterest.feature).where(column == owner_id).order_by(FeatureInterest.feature)
    )
    return list(result.scalars().all())
