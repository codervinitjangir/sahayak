from decimal import Decimal
from typing import Optional, List
from sqlalchemy import Integer, Numeric, String, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config.database import Base


class ServiceCategory(Base):
    __tablename__ = "service_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)

    # Relationships
    services: Mapped[List["Service"]] = relationship(
        "Service", back_populates="category"
    )
    partners: Mapped[List["Partner"]] = relationship(
        "Partner", back_populates="primary_category"
    )


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("service_categories.id"), nullable=True
    )
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    requires_vehicle_equipment: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=True
    )
    # What POST /jobs writes to jobs.price_estimate. Staff-editable (ADR-028);
    # NULL falls back to job_service.SERVICE_BASE_PRICES.
    base_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    # ADR-056: a booking-only service (car wash) is refused without scheduled_for.
    booking_only: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    # Relationships
    category: Mapped[Optional["ServiceCategory"]] = relationship(
        "ServiceCategory", back_populates="services"
    )
    partner_services: Mapped[List["PartnerService"]] = relationship(
        "PartnerService", back_populates="service"
    )
    jobs: Mapped[List["Job"]] = relationship("Job", back_populates="service")
