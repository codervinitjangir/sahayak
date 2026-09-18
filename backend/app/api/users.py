"""
User endpoints: currently the auth link only.

  POST /api/v1/users/{user_id}/link-auth

GAP — there is no user registration endpoint, and this module does not invent
one. Nothing in the API creates a `users` row: no POST /api/v1/users exists, and
the only user rows in the database were inserted by db/seed.sql or by hand. That
was out of scope for the auth task, so it is flagged here rather than filled in.

What that means in practice:

  * A brand-new vehicle owner cannot get onto the platform through the API. They
    can authenticate with Supabase and receive a perfectly valid token, but
    resolve_identity will answer 403 IDENTITY_NOT_LINKED forever, because there
    is no row for link-auth to point at.
  * So this endpoint completes the loop only for users who already exist. It is
    what makes the authenticated jobs flow testable today, and it is what a real
    registration endpoint would call as its final step.
  * Partners do not have this problem: POST /api/v1/partners creates the profile,
    so their signup path is whole.

Whoever picks up user registration owns deciding what creates the row — a
POST /api/v1/users taking name and phone, or a first-login upsert keyed on the
token's phone claim. Both are defensible; neither should be guessed at here.

SCHEDULED — 2026-09-18. This is the committed next task after the dispatch
engine, not an open-ended flag. It gates the Month 2 pilot: the plan is 10-20
manual bookings with real vehicle owners, and every one of those owners hits the
403 above on their first launch. Dispatch goes first only because dispatch can
be tested with scripted tokens and does not need real signup. Pilot bookings do.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.user import UserAuthLinkResponse
from app.services import auth_service
from app.services.auth_service import TokenClaims
from app.utils.auth import get_token_claims

_ERROR_RESPONSES = {
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
    409: {"model": ErrorResponse, "description": "Conflicts with current state"},
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/users",
    tags=["users"],
    responses=_ERROR_RESPONSES,
)


@router.post(
    "/{user_id}/link-auth",
    response_model=ApiResponse[UserAuthLinkResponse],
    status_code=status.HTTP_200_OK,
    summary="Bind a Supabase account to this user profile",
)
async def link_auth(
    user_id: uuid.UUID,
    claims: TokenClaims = Depends(get_token_claims),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[UserAuthLinkResponse]:
    """Attach the caller's verified Supabase account to a user profile.

    This does not create the profile — see the registration gap in the module
    docstring. It binds an existing `users` row to the Supabase account the
    caller is holding, which is what lets resolve_identity answer role="user"
    for them afterwards.

    Depends on get_token_claims rather than get_current_identity for the same
    reason as the partner equivalent: at this moment the token resolves to no
    local row by definition, so requiring one would make the first link
    impossible.

    Succeeds only while users.auth_user_id is null. Re-sending the same account
    is idempotent; a different account is refused with 409 AUTH_ALREADY_LINKED.
    Returns 404 USER_NOT_FOUND for an unknown id.
    """
    user = await auth_service.link_user_auth(db, user_id, claims)
    return envelope(user)
