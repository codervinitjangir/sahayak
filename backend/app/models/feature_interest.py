import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.config.database import Base


class FeatureInterest(Base):
    """A "notify me" on a not-yet-built feature (ADR-035). Exactly one of
    user_id / partner_id is set. alembic/0011 + 0012."""

    __tablename__ = "feature_interest"
    __table_args__ = (
        UniqueConstraint("user_id", "feature", name="uq_feature_interest_user_feature"),
        UniqueConstraint("partner_id", "feature", name="uq_feature_interest_partner_feature"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    partner_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id", ondelete="CASCADE"), nullable=True)
    feature: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
