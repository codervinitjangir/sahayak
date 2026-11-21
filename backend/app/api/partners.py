"""
Partner endpoints: registration, availability toggle, service coverage, auth link, active job.

  POST  /api/v1/partners
  GET   /api/v1/partners/me/offers
  GET   /api/v1/partners/me/jobs/active
  POST  /api/v1/partners/{partner_id}/link-auth
  PATCH /api/v1/partners/{partner_id}/availability
  POST  /api/v1/partners/{partner_id}/location
  POST  /api/v1/partners/{partner_id}/services

Handlers stay thin, exactly as in app/api/jobs.py: FastAPI validates the body,
get_db() supplies the session, app/services/partner_service.py does the work.
Responses go through envelope(), so the body is
`{"data": ..., "meta": {"request_id": ...}}`; failures are rendered in the
matching error envelope by app/middlewares/error_handlers.py.

Registration is the one unauthenticated route here, because it is how a partner
who has no account yet comes into existence. Everything after it requires a
partner token for *this* partner — see app/services/partner_service.py.

Note on scope: partner documents, equipment and the verification workflow are
not here. This module covers identity, shift status and coverage only.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.job import JobDetailResponse
from app.schemas.partner import (
    PartnerAuthLinkResponse,
    PartnerAvailabilityRequest,
    PartnerAvailabilityResponse,
    PartnerCreateRequest,
    PartnerDeleteResponse,
    PartnerEarningsResponse,
    PartnerLocationRequest,
    PartnerLocationResponse,
    PartnerMeResponse,
    PartnerMeUpdateRequest,
    PartnerOfferItem,
    PartnerResponse,
    PartnerServicesLinkRequest,
    PartnerServicesResponse,
    PartnerStatsResponse,
)
from app.services import auth_service, dispatch_service, partner_service
from app.services.auth_service import Identity, TokenClaims
from app.utils.auth import get_token_claims, require_partner

# Same rationale as jobs: make /docs advertise the real error envelope instead
# of FastAPI's default HTTPValidationError, which the handlers no longer emit.
_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid request"},
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {"model": ErrorResponse, "description": "Token valid, action not permitted"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
    409: {"model": ErrorResponse, "description": "Conflicts with current state"},
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

    Unauthenticated by design — this is the signup call. The profile it creates
    is inert until POST /partners/{partner_id}/link-auth binds it to a verified
    Supabase account.

    Returns 400 PARTNER_ALREADY_EXISTS if the phone number is already
    registered, and 400 INVALID_CATEGORY_CODE if primary_category_code does not
    match a service category. verification_status, is_available and the rating
    fields are server-owned and cannot be set from the request.
    """
    partner = await partner_service.register_partner(db, payload)
    return envelope(partner)


@router.get(
    "/me/offers",
    response_model=ApiResponse[List[PartnerOfferItem]],
    status_code=status.HTTP_200_OK,
    summary="List the caller's outstanding job offers",
)
async def list_my_offers(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[List[PartnerOfferItem]]:
    """Every offer the calling partner can still answer, newest first.

    Each item carries the `assignment_id` that
    `POST /api/v1/job-assignments/{assignment_id}/respond` needs. This endpoint
    is the only way a partner client can learn it.

    `/me`, not `/{partner_id}`: the partner is read from the token, so there is
    no id in the path to tamper with and no ownership check to forget. Every
    other route on this router takes a `{partner_id}` and has to prove the
    caller owns it — a list of *my* offers has no reason to accept that risk,
    and `/partners/{someone_else}/offers` should not be a URL that exists.

    A partner with nothing pending gets `"data": []` and a 200. That is the
    normal state of an idle mechanic on shift, not a 404.

    `data` is the array itself, matching GET /vehicles: the envelope already
    carries `meta`, which is where a cursor would go if this ever pages.

    The list is a snapshot taken without a lock, so an offer can be answered by
    the time it is tapped — expect `409 ASSIGNMENT_ALREADY_ANSWERED` as ordinary
    traffic and re-read this list when it happens.
    """
    offers = await dispatch_service.list_open_offers(db, identity.local_id)
    return envelope(offers)


@router.get(
    "/me/jobs/active",
    response_model=ApiResponse[Optional[JobDetailResponse]],
    status_code=status.HTTP_200_OK,
    summary="Get the caller's current active job",
)
async def get_my_active_job(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[Optional[JobDetailResponse]]:
    """Return the calling partner's active job, or null if idle.

    Uses the same predicate as active-job-count: a job where there exists an
    accepted assignment for this partner, and the job status is in the active
    set ('assigned', 'partner_en_route', 'in_progress').

    Returns the full job detail with the same response shape as GET /jobs/{job_id},
    respecting PII/contact-detail rules (the calling partner sees their own
    contact details on the assignment), or null in the data envelope if no active
    job exists.
    """
    job = await partner_service.get_active_job(db, identity)
    return envelope(job)


@router.patch(
    "/me",
    response_model=ApiResponse[PartnerMeResponse],
    status_code=status.HTTP_200_OK,
    summary="Edit your display name (G8)",
)
async def update_my_partner_profile(
    payload: PartnerMeUpdateRequest,
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerMeResponse]:
    """Phone is the login and verification status is staff-owned; neither is editable here."""
    partner = await partner_service.update_my_name(db, identity, payload.name)
    return envelope(PartnerMeResponse.model_validate(partner))


@router.get("/me/export", summary="Download everything Sahayak stores about you (JSON)")
async def export_my_partner_data(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict]:
    """The partner twin of GET /users/me/export (ADR-045 amendment)."""
    return envelope(await partner_service.export_me(db, identity))


@router.delete(
    "/me",
    response_model=ApiResponse[PartnerDeleteResponse],
    status_code=status.HTTP_200_OK,
    summary="Delete your partner account (ADR-045)",
)
async def delete_my_partner_account(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerDeleteResponse]:
    """409 ACCOUNT_HAS_ACTIVE_JOB while a job or an offer is open. Irreversible."""
    await partner_service.delete_me(db, identity)
    return envelope(PartnerDeleteResponse())


@router.get(
    "/me/stats",
    response_model=ApiResponse[PartnerStatsResponse],
    status_code=status.HTTP_200_OK,
    summary="Get the caller's trust and performance stats",
)
async def get_my_stats(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerStatsResponse]:
    """Return the calling partner's trust stats: rating average, rating count,
    verification status, acceptance rate percentage, and completed job count.
    """
    stats = await partner_service.get_partner_stats(db, identity)
    return envelope(stats)


@router.get(
    "/me/services",
    response_model=ApiResponse[PartnerServicesResponse],
    status_code=status.HTTP_200_OK,
    summary="List the services the caller offers",
)
async def list_my_services(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerServicesResponse]:
    """Every service this partner is linked to, with its base price.

    The read side of POST /partners/{partner_id}/services. A partner with no
    linked services gets an empty list, not a 404: not having declared coverage
    yet is an ordinary pre-verification state, and dispatch simply will not
    offer them work.
    """
    services = await partner_service.get_partner_services(db, identity)
    return envelope(services)


@router.get(
    "/me/earnings",
    response_model=ApiResponse[PartnerEarningsResponse],
    status_code=status.HTTP_200_OK,
    summary="Get the caller's completed-job earnings",
)
async def get_my_earnings(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerEarningsResponse]:
    """Today, this-week and lifetime payouts for the calling partner.

    Sums jobs.price_final over completed jobs where this partner holds the
    completed assignment. Calendar boundaries are IST. A partner with no
    completed work gets zeros rather than a 404 — that is every partner's
    first day.
    """
    earnings = await partner_service.get_partner_earnings(db, identity)
    return envelope(earnings)


@router.post(
    "/{partner_id}/link-auth",
    response_model=ApiResponse[PartnerAuthLinkResponse],
    status_code=status.HTTP_200_OK,
    summary="Bind a Supabase account to this partner profile",
)
async def link_auth(
    partner_id: uuid.UUID,
    claims: TokenClaims = Depends(get_token_claims),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerAuthLinkResponse]:
    """Attach the caller's verified Supabase account to a partner profile.

    Kept as its own endpoint rather than folded into register_partner, because
    the two happen at different moments and by different means: registration may
    be done by ops on a mechanic's behalf, over the phone, before that mechanic
    has ever opened the app — while linking can only be done by whoever actually
    holds the OTP. Merging them would force a partner to exist in Supabase before
    they exist to us, which is backwards for a field workforce that gets
    onboarded in person.

    This depends on get_token_claims rather than get_current_identity on
    purpose. At this moment the token's `sub` matches no row by definition — that
    is what the call is about to fix — so requiring a resolved local identity
    would make the first link impossible for every account.

    Succeeds only while partners.auth_user_id is null. Re-sending the same
    account is idempotent; a *different* account is refused with 409
    AUTH_ALREADY_LINKED, which is what stops a claimed profile from being taken
    over. Returns 404 PARTNER_NOT_FOUND for an unknown id.
    """
    partner = await auth_service.link_partner_auth(db, partner_id, claims)
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
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerAvailabilityResponse]:
    """Turn a partner on or off shift.

    A partner may only toggle their own availability: the token must belong to
    the partner_id in the path, or the call is refused with 403 FORBIDDEN.

    Only partners with is_available true are considered by dispatch. Safe to
    call repeatedly — setting the flag to the value it already holds succeeds.
    Returns 404 PARTNER_NOT_FOUND for an unknown id.
    """
    partner = await partner_service.set_availability(
        db, partner_id, payload.is_available, identity
    )
    return envelope(partner)


@router.post(
    "/{partner_id}/location",
    response_model=ApiResponse[PartnerLocationResponse],
    status_code=status.HTTP_200_OK,
    summary="Report a partner's current location",
)
async def update_location(
    partner_id: uuid.UUID,
    payload: PartnerLocationRequest,
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerLocationResponse]:
    """Report where this partner is right now.

    The position is stored in Redis only. Nothing is written to Postgres — a
    partner app on shift calls this every few seconds, and a durable write per
    ping would be a write storm for data that is stale within the minute. There
    is no current_location column to write to, deliberately.

    A partner may only report their own position; another partner's id in the
    path is refused with 403 FORBIDDEN. Returns 404 PARTNER_NOT_FOUND for an
    unknown id, and 500 if the location store is unreachable — which is a real
    failure and is reported as one, rather than being swallowed into a dispatch
    that then finds nobody nearby.

    Coordinates are taken lat-first, as a GPS API reports them. The
    longitude-first order the geo index needs is applied server-side.

    200 rather than 201: the call overwrites one partner's position in place and
    creates no addressable resource.
    """
    recorded_at = await partner_service.update_location(
        db, partner_id, payload.lat, payload.lng, identity
    )
    return envelope(
        PartnerLocationResponse(partner_id=partner_id, recorded_at=recorded_at)
    )


@router.post(
    "/{partner_id}/services",
    response_model=ApiResponse[PartnerServicesResponse],
    status_code=status.HTTP_200_OK,
    summary="Link services to a partner",
)
async def link_services(
    partner_id: uuid.UUID,
    payload: PartnerServicesLinkRequest,
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerServicesResponse]:
    """Declare which services this partner can perform.

    A partner may only edit their own coverage; another partner's id in the path
    is refused with 403 FORBIDDEN.

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
            db, partner_id, payload.service_codes, identity
        )
    )


# ---------------------------------------------------------------------------
# Documents (ADR-038): the partner's checklist, upload and confirm. The partner
# never gets a file back; staff review it in the admin console.
# ---------------------------------------------------------------------------
from app.schemas.partner_document import (  # noqa: E402
    DocumentUploadRequest,
    DocumentUploadTicket,
    PartnerDocumentsResponse,
)
from app.services import partner_document_service  # noqa: E402


@router.get(
    "/me/documents",
    response_model=ApiResponse[PartnerDocumentsResponse],
    summary="My required documents and their review status",
)
async def my_documents(
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerDocumentsResponse]:
    return envelope(await partner_document_service.checklist(db, identity.local_id))


@router.post(
    "/me/documents",
    response_model=ApiResponse[DocumentUploadTicket],
    status_code=status.HTTP_201_CREATED,
    summary="Start a document upload: returns a one-time upload URL",
)
async def start_document_upload(
    payload: DocumentUploadRequest,
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[DocumentUploadTicket]:
    """PUT the file to `upload_url` (Content-Type as declared, at most 5 MB), then
    POST .../{document_id}/confirm. 400 DOCUMENT_NOT_REQUIRED for tow documents
    from a partner who does not offer towing. 503 DOCUMENT_STORAGE_UNAVAILABLE."""
    return envelope(await partner_document_service.start_upload(db, identity.local_id, payload))


@router.post(
    "/me/documents/{document_id}/confirm",
    response_model=ApiResponse[PartnerDocumentsResponse],
    summary="Confirm an upload finished; it replaces any earlier document of that type",
)
async def confirm_document_upload(
    document_id: uuid.UUID,
    identity: Identity = Depends(require_partner),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PartnerDocumentsResponse]:
    """409 DOCUMENT_NOT_UPLOADED if the file is not in storage yet. 404 for an id
    that is not yours."""
    return envelope(await partner_document_service.confirm_upload(db, identity.local_id, document_id))
