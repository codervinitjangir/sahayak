"""The service catalogue.

  GET /api/v1/services

Unauthenticated, and that is the one decision in this module worth defending.

Three reasons it carries no token. It holds no user data — a dozen seeded rows
naming the kinds of help Sahayak arranges, identical for every caller, writable
only by migration. The owner app needs it before a token exists: the landing page
lists services, and the request screen renders its grid while sign-in is still
resolving. And `POST /api/v1/partners` is already unauthenticated for the same
shape of reason, so this is the existing precedent rather than a new exception.

What it closes: both frontends hardcoded this list to match db/seed.sql by hand
(`web/src/pages/owner/RequestHelpPage.tsx` has a FALLBACK_SERVICES array). That is
fine until the seed changes, at which point the UI offers `service_code` values the
dispatch engine will refuse — and the failure surfaces as a 400 on the emergency
button, which is the worst place to find it.

Read-only by design. There is no POST here: a service code is part of the API
contract, since `POST /jobs` and `POST /partners/{id}/services` both accept one,
and codes that could be invented at runtime would make that contract unknowable.
"""
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.repositories import service_repository
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.service import ServiceCatalogItem, ServiceCatalogResponse
from app.services.job_service import base_price_for

_ERROR_RESPONSES = {
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/services",
    tags=["services"],
    responses=_ERROR_RESPONSES,
)


@router.get(
    "",
    response_model=ApiResponse[ServiceCatalogResponse],
    status_code=status.HTTP_200_OK,
    summary="List every service that can be requested",
)
async def list_services(
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ServiceCatalogResponse]:
    """The whole catalogue, grouped-ready: ordered by category, then name.

    No service layer behind this. There is no rule to apply, no transaction to own
    and no error to map — a pass-through function would add a layer that transforms
    nothing, which the layering convention exists to prevent rather than require.
    The same argument is made at GET /api/v1/auth/me.

    `base_price` is the same value (job_service.base_price_for) POST /jobs uses to populate
    jobs.price_estimate, so a client can show the amount the backend will
    actually charge instead of maintaining a second price table that drifts.
    It is the base before any future distance or surge adjustment — the field
    is named for what it is, not for what a total might become.
    """
    rows = await service_repository.list_services(db)
    items = [
        ServiceCatalogItem(
            id=service.id,
            code=service.code,
            name=service.name,
            requires_vehicle_equipment=bool(service.requires_vehicle_equipment),
            base_price=base_price_for(service),
            category_id=service.category_id,
            category_code=category.code if category else None,
            category_name=category.name if category else None,
        )
        for service, category in rows
    ]
    return envelope(ServiceCatalogResponse(items=items, total=len(items)))
