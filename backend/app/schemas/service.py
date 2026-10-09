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

    **There is no price, and that absence is not an oversight.** The `services`
    table has no price column, `jobs.price_estimate` is nullable and nothing in the
    application ever writes it, so there is no pricing data on this side to return.
    Both frontends currently display prices from their own hardcoded tables; those
    numbers exist nowhere in the backend and are not stored against a job. Adding
    an invented `estimated_price` here would make that look authoritative, which is
    the one thing worse than its being absent. See TASKS.md.
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
    category_id: Optional[int] = None
    category_code: Optional[str] = Field(
        None, description="'towing' | 'mechanical' | 'fuel'. Null only if unseeded."
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

