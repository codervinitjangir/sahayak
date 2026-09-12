import uuid
from datetime import datetime
from typing import Optional
from decimal import Decimal
from sqlalchemy import (
    String, DateTime, Numeric, ForeignKey, CheckConstraint, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=True
    )
    amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 2), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )
    payment_method: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    gateway_ref_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','paid','failed','refunded')",
            name="check_payment_status"
        ),
    )

    # Relationships
    job: Mapped[Optional["Job"]] = relationship("Job", back_populates="payments")
