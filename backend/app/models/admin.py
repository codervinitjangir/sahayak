import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, DateTime, CheckConstraint, func
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("role IN ('ops', 'super_admin')", name="check_admin_role"),
    )

    # Relationships
    verified_documents: Mapped[List["PartnerDocument"]] = relationship(
        "PartnerDocument", back_populates="verified_by_admin"
    )
