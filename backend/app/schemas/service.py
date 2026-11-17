from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class ServiceCategoryBase(BaseModel):
    code: str
    name: str


class ServiceCategoryCreate(ServiceCategoryBase):
    pass


class ServiceCategoryResponse(ServiceCategoryBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class ServiceBase(BaseModel):
    code: str
    name: str
    requires_vehicle_equipment: Optional[bool] = False
    category_id: Optional[int] = None


class ServiceCreate(ServiceBase):
    pass


class ServiceResponse(ServiceBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class ServiceCatalogItem(BaseModel):
    """One row of GET /api/v1/services — what a client may put in `service_code`.

    `code` is the field that matters: it is what `POST /jobs` and
    `POST /partners/{id}/services` accept, and until this endpoint existed both
    frontends hardcoded the list to match db/seed.sql by hand. A seed change then
    moved the backend and left the UI offering codes that would be refused.

    The category is flattened in rather than nested, because every consumer groups
    by it and a nested object would make that a two-step read for no gain. It is
    optional only because `services.category_id` is nullable in the schema.

    `base_price` is deliberately the same constant `POST /jobs` uses to write
    `jobs.price_estimate` (SERVICE_BASE_PRICES in job_service). The `services`
    table still has no price column, but the split is now honest: this is a
    read-only projection of the pricing constant, not a second source of truth.
    A service missing from that table returns null rather than a guessed number.
    """

    id: int
    code: str = Field(..., description="The value `service_code` takes in POST /jobs.")
    name: str
    requires_vehicle_equipment: bool = Field(
        False,
        description=(
            "True when a partner needs registered equipment to be offered this "
            "service — a flatbed, for instance. Informational for an owner; the "
            "dispatch engine applies it as a hard filter regardless."
        ),
    )
    base_price: Optional[Decimal] = Field(
        None,
        description=(
            "Base INR price before distance/surge adjustment. Equals the "
            "price_estimate POST /jobs stores for this code. Null when the "
            "pricing table has no entry for this service."
        ),
    )
    category_id: Optional[int] = None
    category_code: Optional[str] = Field(
        None, description="'towing' | 'mechanical'. Null only if unseeded."
    )
    category_name: Optional[str] = None


class ServiceCatalogResponse(BaseModel):
    """The whole catalogue in one read.

    Unpaginated on purpose: this is a seeded reference table of a dozen rows that
    changes by migration, not by use. Pagination would add a cursor to something
    whose entire value is that a client can fetch it once at startup and keep it.
    """

    items: list[ServiceCatalogItem]
    total: int = Field(..., description="Rows returned. Equal to len(items), always.")

