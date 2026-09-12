import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String, DateTime, SmallInteger, ForeignKey, CheckConstraint,
    UniqueConstraint, func, Text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config.database import Base


class Rating(Base):
    __tablename__ = "ratings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=True
    )
    rated_by: Mapped[str] = mapped_column(String(10), nullable=False)
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("rated_by IN ('user','partner')", name="check_rated_by"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="check_rating_range"),
        UniqueConstraint("job_id", "rated_by", name="uq_job_rated_by"),
    )

    # Relationships
    job: Mapped[Optional["Job"]] = relationship("Job", back_populates="ratings")
