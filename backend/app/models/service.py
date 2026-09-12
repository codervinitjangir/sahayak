from typing import Optional, List
from sqlalchemy import Integer, String, Boolean, ForeignKey
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

    # Relationships
    category: Mapped[Optional["ServiceCategory"]] = relationship(
        "ServiceCategory", back_populates="services"
    )
    partner_services: Mapped[List["PartnerService"]] = relationship(
        "PartnerService", back_populates="service"
    )
    jobs: Mapped[List["Job"]] = relationship("Job", back_populates="service")
