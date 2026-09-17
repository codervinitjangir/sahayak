"""
Partner endpoints: registration, availability toggle and service coverage.

  POST  /api/v1/partners
  PATCH /api/v1/partners/{partner_id}/availability
  POST  /api/v1/partners/{partner_id}/services

Handlers stay thin, exactly as in app/api/jobs.py: FastAPI validates the body,
get_db() supplies the session, app/services/partner_service.py does the work.
Responses go through envelope(), so the body is
`{"data": ..., "meta": {"request_id": ...}}`; failures are rendered in the
matching error envelope by app/middlewares/error_handlers.py.

Note on scope: partner documents, equipment and the verification workflow are
not here. This module covers identity, shift status and coverage only.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.partner import (
    PartnerAvailabilityRequest,
    PartnerAvailabilityResponse,
    PartnerCreateRequest,
    PartnerResponse,
    PartnerServicesLinkRequest,
    PartnerServicesResponse,
)
from app.services import partner_service

# Same rationale as jobs: make /docs advertise the real error envelope instead
# of FastAPI's default HTTPValidationError, which the handlers no longer emit.
_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid request"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/partners",
    tags=["partners"],
    responses=_ERROR_RESPONSES,
)


@router.post(
    "",
    response_model=ApiResponse[PartnerResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Register a partner",
)
async def register_partner(
    payload: PartnerCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerResponse]:
    """Register a mechanic as pending verification and off-shift.

    Returns 400 PARTNER_ALREADY_EXISTS if the phone number is already
    registered, and 400 INVALID_CATEGORY_CODE if primary_category_code does not
    match a service category. verification_status, is_available and the rating
    fields are server-owned and cannot be set from the request.
    """
    partner = await partner_service.register_partner(db, payload)
    return envelope(partner)


@router.patch(
    "/{partner_id}/availability",
    response_model=ApiResponse[PartnerAvailabilityResponse],
    status_code=status.HTTP_200_OK,
    summary="Set a partner's availability",
)
async def set_availability(
    partner_id: uuid.UUID,
    payload: PartnerAvailabilityRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerAvailabilityResponse]:
    """Turn a partner on or off shift.

    Only partners with is_available true are considered by dispatch. Safe to
    call repeatedly — setting the flag to the value it already holds succeeds.
    Returns 404 PARTNER_NOT_FOUND for an unknown id.
    """
    partner = await partner_service.set_availability(
        db, partner_id, payload.is_available
    )
    return envelope(partner)


@router.post(
    "/{partner_id}/services",
    response_model=ApiResponse[PartnerServicesResponse],
    status_code=status.HTTP_200_OK,
    summary="Link services to a partner",
)
async def link_services(
    partner_id: uuid.UUID,
    payload: PartnerServicesLinkRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerServicesResponse]:
    """Declare which services this partner can perform.

    Returns the partner's full current service list, not only the newly linked
    rows, and is safe to call repeatedly with the same codes. If any code is
    unknown the whole request is rejected with 400 INVALID_SERVICE_CODE naming
    the offending code(s) — nothing is partially linked. Returns 404
    PARTNER_NOT_FOUND for an unknown partner id.

    200 rather than 201 on purpose: the call declares a desired state and may
    create nothing at all, so there is no single new resource to point at.
    """
    return envelope(
        await partner_service.link_partner_services(
            db, partner_id, payload.service_codes
        )
    )
