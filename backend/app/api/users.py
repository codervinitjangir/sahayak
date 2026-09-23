"""
User endpoints: registration and the auth link.

  POST /api/v1/users
  POST /api/v1/users/{user_id}/link-auth

Handlers stay thin, exactly as in app/api/partners.py: FastAPI validates the
body, get_db() supplies the session, app/services/user_service.py does the work.
Responses go through envelope(); failures are rendered in the matching error
envelope by app/middlewares/error_handlers.py.

Both routes depend on get_token_claims rather than get_current_identity, and for
the same reason: at the moment either is called the token's `sub` matches no
local row, which is precisely what the call exists to fix. Requiring a resolved
identity would make the first one impossible for every account.

Registration closes the gap this module used to document. Until 2026-09-18
nothing in the API created a `users` row — the only ones present came from
db/seed.sql or by hand — so a brand-new vehicle owner could pass OTP, hold a
perfectly valid token, and be refused by every endpoint forever. That made the
Month 2 pilot (10-20 manual bookings with real owners) impossible to run, since
every one of those owners would have hit it on first launch.

Why registration is one call here and two for partners: an owner signs up on
their own phone, holding the token, with nobody else involved, so the profile is
created already bound to their account. A mechanic is onboarded in person by ops
— frequently before they have ever opened an app — so their profile has to be
able to exist before their Supabase account does. Same destination, different
starting points.

link-auth is therefore no longer part of the owner signup path. It is kept for
the case registration does not cover: a `users` row that arrived by some other
route (seed data, a future migration) and needs binding after the fact.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.user import (
    UserAuthLinkResponse,
    UserRegisterRequest,
    UserRegistrationResponse,
)
from app.services import auth_service, user_service
from app.services.auth_service import TokenClaims
from app.utils.auth import get_token_claims

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
    prefix=f"{API_V1_PREFIX}/users",
    tags=["users"],
    responses=_ERROR_RESPONSES,
)


@router.post(
    "",
    response_model=ApiResponse[UserRegistrationResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Register a vehicle owner",
)
async def register_user(
    payload: UserRegisterRequest,
    claims: TokenClaims = Depends(get_token_claims),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[UserRegistrationResponse]:
    """Create the caller's owner profile and bind it to their Supabase account.

    Authenticated, unlike POST /partners: the profile this creates is live
    immediately — it can request jobs the moment it exists — so it must belong
    to somebody who has proved they hold the account.

    The returned `id` is the local user id, which is the foreign key every later
    call hangs off. Nothing afterwards needs to send it: POST /jobs reads the
    owner from the token.

    Returns 400 USER_ALREADY_EXISTS if the phone number or email is already
    registered, 400 PHONE_MISMATCH if the number is not the one the token
    verified, and 409 AUTH_ALREADY_LINKED if this Supabase account already owns
    a profile. phone_verified is server-owned and records what the token proved.
    """
    user = await user_service.register_user(db, payload, claims)
    return envelope(user)


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
