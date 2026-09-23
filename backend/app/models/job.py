import uuid
from datetime import datetime
from typing import Optional, List
from decimal import Decimal
from sqlalchemy import (
    String, DateTime, Numeric, Integer, SmallInteger, ForeignKey,
    CheckConstraint, func, Text, Boolean
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geography
from app.config.database import Base


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=True
    )
    vehicle_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    service_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("services.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), default="requested", nullable=False
    )
    pickup_location: Mapped[object] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=False
    )
    pickup_address_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    drop_location: Mapped[Optional[object]] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True
    )
    issue_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    issue_photo_urls: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(Text), nullable=True
    )
    price_estimate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 2), nullable=True
    )
    price_final: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 2), nullable=True
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancellation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('requested','matching','assigned','partner_en_route',"
            "'in_progress','completed','cancelled','no_match_found')",
            name="check_job_status"
        ),
    )

    # Relationships
    user: Mapped[Optional["User"]] = relationship("User", back_populates="jobs")
    vehicle: Mapped[Optional["Vehicle"]] = relationship("Vehicle", back_populates="jobs")
    service: Mapped["Service"] = relationship("Service", back_populates="jobs")
    assignments: Mapped[List["JobAssignment"]] = relationship(
        "JobAssignment", back_populates="job", cascade="all, delete-orphan"
    )
    status_history: Mapped[List["JobStatusHistory"]] = relationship(
        "JobStatusHistory", back_populates="job", cascade="all, delete-orphan"
    )
    ratings: Mapped[List["Rating"]] = relationship(
        "Rating", back_populates="job", cascade="all, delete-orphan"
    )
    payments: Mapped[List["Payment"]] = relationship(
        "Payment", back_populates="job", cascade="all, delete-orphan"
    )
    notifications: Mapped[List["Notification"]] = relationship(
        "Notification", back_populates="job", cascade="all, delete-orphan"
    )


class JobAssignment(Base):
    __tablename__ = "job_assignments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    partner_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default="offered", nullable=False
    )
    offered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    responded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    accepted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    distance_at_offer_m: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    estimated_arrival_min: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    matching_score: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 4), nullable=True
    )
    assignment_rank: Mapped[Optional[int]] = mapped_column(
        SmallInteger, nullable=True
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The individual weighted terms behind matching_score, snapshotted at offer
    # time: every input (distance, load, rating) moves, so a score recomputed
    # later explains a decision nobody made. Written by app/utils/scoring.py,
    # which owns the key set — Postgres does not enforce the shape. See
    # db/migrations/002.
    score_components: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # True when a nearest-partner-only search would have picked this candidate
    # too. The control arm for the divergence-rate metric. Always written
    # explicitly, so false means "checked, and no" rather than "never looked".
    was_baseline_choice: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            # 'cancelled' added by db/migrations/003. Kept distinct from
            # 'rejected' on purpose: 'rejected' is the partner's answer to an
            # offer and feeds acceptance rate, so reusing it for a job the
            # *customer* cancelled would penalise the partner for someone
            # else's decision. See ADR-012.
            "status IN ('offered','accepted','rejected','timed_out','completed','cancelled')",
            name="check_assignment_status"
        ),
    )

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="assignments")
    partner: Mapped[Optional["Partner"]] = relationship("Partner", back_populates="assignments")


class JobStatusHistory(Base):
    __tablename__ = "job_status_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="status_history")
