"""Identity resolution: the one call a freshly signed-in client makes first.

  GET /api/v1/auth/me

Its own router rather than a route on users or partners, because it is the one
endpoint that belongs to none of the three roles — an owner, a mechanic and an
admin all call this same path and each gets their own answer. Hanging it off
/users would make a partner's "who am I" a request to the owners' resource,
which reads as a bug every time someone new finds it.

Why it has to exist at all: a client that has just finished a phone OTP holds a
verified Supabase token and knows nothing else. It does not know whether we have
a profile for that account, which of the three kinds it is, or what our local id
for it is — and every id-bearing route it might try needs that answer first. Up
to now the only way to find out was to call a resource endpoint and read the
error code off the failure, which means the routing decision for every sign-in
was made from the remains of a request that was meant to do something else.

The endpoint does no work of its own. get_current_identity already resolves the
token against users, partners and admins and already raises the two 403s that
tell a client what to do next (USER_NOT_REGISTERED → sign up,
IDENTITY_NOT_LINKED → an unclaimed profile exists for this number). This route
is a thin way to *ask* that question directly instead of inferring it, so all
the behaviour — and all the security — lives where it already lived. See ADR-011
for why the two codes are distinct.
"""
from fastapi import APIRouter, Depends, status

from app.api import API_V1_PREFIX
from app.schemas.auth import IdentityResponse
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity

_ERROR_RESPONSES = {
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {
        "model": ErrorResponse,
        "description": (
            "Token is valid but resolves to no profile — USER_NOT_REGISTERED "
            "(sign up) or IDENTITY_NOT_LINKED (an unclaimed profile exists for "
            "this number)"
        ),
    },
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/auth",
    tags=["auth"],
    responses=_ERROR_RESPONSES,
)


@router.get(
    "/me",
    response_model=ApiResponse[IdentityResponse],
    status_code=status.HTTP_200_OK,
    summary="Resolve the caller's token to a local profile",
)
async def read_me(
    identity: Identity = Depends(get_current_identity),
) -> ApiResponse[IdentityResponse]:
    """Return the role and local id this token resolves to.

    Depends on get_current_identity rather than any of the three require_*
    wrappers on purpose: restricting it to one role would defeat the point,
    since a client calls this precisely because it does not yet know which role
    it holds. A partner asking "who am I" must get "partner", not a 403.

    No database session is taken here. get_current_identity already opened one
    to resolve the token and this handler needs nothing further — which is also
    why there is no service function behind it. A pass-through service would add
    a layer that transforms nothing.
    """
    return envelope(IdentityResponse(role=identity.role, id=identity.local_id))
