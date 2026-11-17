"""Feature interest ("notify me") rules and transactions (ADR-035)."""
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import feature_interest_repository
from app.services.auth_service import Identity
from app.utils.errors import BadRequestError, ErrorCode, ForbiddenError, InternalError
from app.utils.logging import log_event

# Must match the CHECK constraint in alembic/0012 and the clients' COMING_SOON ids.
OWNER_FEATURES = ("scheduled", "doorstep", "pickup-drop")
PARTNER_FEATURES = ("financing", "certification", "custody-tier")
_BY_SIDE = {"user": OWNER_FEATURES, "partner": PARTNER_FEATURES}


def _side(identity: Identity) -> str:
    if identity.role not in _BY_SIDE:
        raise ForbiddenError(ErrorCode.FORBIDDEN, "Only owners and partners can ask to be notified.")
    return identity.role


async def register(db: AsyncSession, identity: Identity, feature: str) -> list[str]:
    """Idempotent. A feature from the other side's list is a 400, so an owner
    cannot sign up for a partner programme or the other way round."""
    side = _side(identity)
    if feature not in _BY_SIDE[side]:
        raise BadRequestError(ErrorCode.INVALID_FEATURE, "This feature is not offered to your profile.")
    try:
        await feature_interest_repository.add(db, side=side, owner_id=identity.local_id, feature=feature)
        features = await feature_interest_repository.list_for(db, side=side, owner_id=identity.local_id)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not save your interest") from exc
    log_event("feature_interest_registered", side=side, feature=feature, outcome="success")
    return features


async def list_mine(db: AsyncSession, identity: Identity) -> list[str]:
    side = _side(identity)
    return await feature_interest_repository.list_for(db, side=side, owner_id=identity.local_id)
