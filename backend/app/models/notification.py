import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String, Boolean, DateTime, ForeignKey, CheckConstraint, Index, func, text, Text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config.database import Base


class Notification(Base):
    """One alert addressed to one account about one thing that happened.

    Written inside the same transaction as the status change it describes, at the
    same seams that write `job_status_history` — see ADR-019 for why a
    notification is treated as a side record of a status change rather than as
    delivery work, and why the message text deliberately contains no names,
    phone numbers or coordinates.
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Which table recipient_id points at. There is no FK, because it points at
    # `users` or `partners` depending on this column, and a polymorphic
    # reference cannot be one — both sides are validated by the service before
    # the row is built.
    recipient_type: Mapped[str] = mapped_column(String(10), nullable=False)
    recipient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # 'in_app' for everything this codebase writes. 'push'/'sms' are permitted by
    # the constraint and written by nothing — there is no delivery worker.
    channel: Mapped[str] = mapped_column(String(10), nullable=False)
    # The machine-readable kind clients branch on ('job_accepted', 'job_completed',
    # ...). `message` below is the human half and may be reworded freely; this may
    # not. Intentionally not a CHECK constraint or an Enum — see migration 005 for
    # why, and NOTIFICATION_EVENTS in app/services/notification_service.py for the
    # vocabulary, which is the only thing that writes this column.
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)
    # Creation time, not delivery time. The column name predates the decision
    # that these rows are polled rather than sent.
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint("recipient_type IN ('user','partner')", name="check_recipient_type"),
        CheckConstraint(
            "channel IN ('in_app','push','sms')", name="check_notification_channel"
        ),
        # Declared so the model matches the live database
        # (db/migrations/005_notifications_writable.sql). The feed's only read
        # shape is (recipient_type, recipient_id) ordered by sent_at DESC.
        Index(
            "idx_notifications_recipient_sent",
            "recipient_type",
            "recipient_id",
            text("sent_at DESC"),
        ),
        Index(
            "idx_notifications_recipient_unread",
            "recipient_type",
            "recipient_id",
            postgresql_where=text("is_read IS NOT TRUE"),
        ),
    )

    # Relationships
    job: Mapped[Optional["Job"]] = relationship("Job", back_populates="notifications")
