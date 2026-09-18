import uuid
from datetime import datetime, date
from typing import Optional, List
from decimal import Decimal
from sqlalchemy import (
    String, Boolean, DateTime, Date, Numeric, Integer, ForeignKey,
    CheckConstraint, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config.database import Base


class Partner(Base):
    __tablename__ = "partners"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(15), unique=True, nullable=False)
    primary_category_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("service_categories.id"), nullable=True
    )
    verification_status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )
    is_independent_contractor: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=True
    )
    is_available: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=True
    )
    rating_avg: Mapped[Decimal] = mapped_column(
        Numeric(2, 1), default=Decimal("0.0"), nullable=True
    )
    rating_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=True
    )
    # Supabase Auth's `sub` claim. Nullable because POST /api/v1/partners stays
    # open (a mechanic can be registered before they hold an account) and unique
    # so one Supabase account cannot control two partner profiles. The null check
    # in auth_service.link_partner_auth is what stops an unlinked profile from
    # being claimed twice. See db/migrations/001.
    auth_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "verification_status IN ('pending','verified','rejected','suspended')",
            name="check_partner_verification_status"
        ),
    )

    # Relationships
    primary_category: Mapped[Optional["ServiceCategory"]] = relationship(
        "ServiceCategory", back_populates="partners"
    )
    partner_services: Mapped[List["PartnerService"]] = relationship(
        "PartnerService", back_populates="partner", cascade="all, delete-orphan"
    )
    equipment: Mapped[List["PartnerEquipment"]] = relationship(
        "PartnerEquipment", back_populates="partner", cascade="all, delete-orphan"
    )
    documents: Mapped[List["PartnerDocument"]] = relationship(
        "PartnerDocument", back_populates="partner", cascade="all, delete-orphan"
    )
    assignments: Mapped[List["JobAssignment"]] = relationship(
        "JobAssignment", back_populates="partner"
    )


class PartnerService(Base):
    __tablename__ = "partner_services"

    partner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id", ondelete="CASCADE"), primary_key=True
    )
    service_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("services.id"), primary_key=True
    )

    # Relationships
    partner: Mapped["Partner"] = relationship("Partner", back_populates="partner_services")
    service: Mapped["Service"] = relationship("Service", back_populates="partner_services")


class PartnerEquipment(Base):
    __tablename__ = "partner_equipment"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    partner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id", ondelete="CASCADE"), nullable=False
    )
    equipment_type: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    registration_number: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    verification_status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "verification_status IN ('pending','verified','rejected')",
            name="check_equipment_verification_status"
        ),
    )

    # Relationships
    partner: Mapped["Partner"] = relationship("Partner", back_populates="equipment")


class PartnerDocument(Base):
    __tablename__ = "partner_documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    partner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id", ondelete="CASCADE"), nullable=False
    )
    doc_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    file_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )
    verified_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admins.id"), nullable=True
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','approved','rejected','expired')",
            name="check_document_status"
        ),
    )

    # Relationships
    partner: Mapped["Partner"] = relationship("Partner", back_populates="documents")
    verified_by_admin: Mapped[Optional["Admin"]] = relationship(
        "Admin", back_populates="verified_documents"
    )
