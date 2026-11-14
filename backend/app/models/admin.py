import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, DateTime, CheckConstraint, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config.database import Base


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(150), unique=True, nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="ops", nullable=False)
    # Supabase Auth's `sub` claim, as on User and Partner. Nullable because the
    # seeded ops rows hold no account yet, unique so a token cannot resolve to
    # two admins.
    #
    # There is no link_admin_auth: unlike a user or partner profile, an admins
    # row is a privilege grant, and it is provisioned by an UPDATE from whoever
    # holds database access rather than claimed self-service. See
    # db/migrations/007 and ADR-020.
    auth_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # ADR-029. `phone` is the number the invite was bound to. `disabled_at` is a
    # soft off-switch: resolve_identity answers 403 and the row, with its audit
    # history, stays.
    phone: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    invited_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )
    disabled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("role IN ('ops', 'super_admin', 'support', 'finance')", name="check_admin_role"),
    )

    # Relationships
    verified_documents: Mapped[List["PartnerDocument"]] = relationship(
        "PartnerDocument", back_populates="verified_by_admin"
    )
