"""
FastAPI dependencies that turn an Authorization header into a verified identity.

Deliberately dependencies rather than middleware. Middleware runs on every
request including /health and /docs, and would have to carry its own list of
which paths to skip — a list that silently grants access to any route someone
forgets to add. A dependency inverts that: a route is unauthenticated only if
its signature says nothing about identity, which is visible in the route
definition and in the generated OpenAPI schema. The existing repo already uses
this shape for `get_db`, so `Depends(...)` is also the local idiom;
app/middlewares/ is reserved for genuinely cross-cutting concerns (request ids,
error rendering).

The rules and the database lookups live in app/services/auth_service.py. This
module is only the wiring: pull the header, hand it over, raise or return.
"""
from typing import Optional

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.database import get_db
from app.services.auth_service import Identity, TokenClaims, decode_token, resolve_identity
from app.utils.errors import ErrorCode, ForbiddenError, UnauthorizedError

# auto_error=False so a missing or malformed header comes back as None and is
# refused below in our own error envelope. Left at the default, FastAPI would
# raise its own HTTPException with status 403 and no error code — the wrong
# status for "no credentials supplied", and a response shape that skips the
# contract every other failure in this API follows.
_bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="Supabase access token",
    description=(
        "Supabase Auth access token (the `access_token` from a verified phone "
        "OTP session). Send as `Authorization: Bearer <token>`."
    ),
)


async def get_token_claims(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> TokenClaims:
    """Verify the bearer token and return its claims, without any local lookup.

    This is the dependency for the link-auth endpoints, and only those. At the
    moment a new account is linked, its `sub` matches no row in users or
    partners yet — that is the entire point of the call — so requiring a
    resolved local identity here would make the first link impossible.
    Everything else should depend on get_current_identity instead.
    """
    if credentials is None:
        # Covers both a missing Authorization header and a non-Bearer scheme;
        # HTTPBearer collapses them into None when auto_error is off.
        raise UnauthorizedError("Missing or malformed Authorization header.")
    return decode_token(credentials.credentials)


async def get_current_identity(
    claims: TokenClaims = Depends(get_token_claims),
    db: AsyncSession = Depends(get_db),
) -> Identity:
    """The caller's verified identity, resolved to one of our own rows.

    This is the dependency to reach for by default. It answers "who is this" in
    terms the domain can use — a users.id or a partners.id — so a handler never
    has to take the client's word for it.
    """
    return await resolve_identity(db, claims)


async def require_user(
    identity: Identity = Depends(get_current_identity),
) -> Identity:
    """Identity, restricted to vehicle owners.

    For endpoints only a customer can drive, like requesting a job. A mechanic
    holding a valid partner token gets 403 here, not 401: we know exactly who
    they are, they simply may not do this.
    """
    if identity.role != "user":
        raise ForbiddenError(
            code=ErrorCode.FORBIDDEN,
            message="This endpoint is available to vehicle owners only.",
        )
    return identity


async def require_partner(
    identity: Identity = Depends(get_current_identity),
) -> Identity:
    """Identity, restricted to mechanics.

    For the partner-only endpoints — the availability toggle and service
    linkage. Note that this establishes *role*, not ownership: a partner passing
    this check is still any partner, so a route that takes a partner_id in its
    path must additionally compare it against identity.local_id. That second
    check lives in partner_service, next to the write it protects.
    """
    if identity.role != "partner":
        raise ForbiddenError(
            code=ErrorCode.FORBIDDEN,
            message="This endpoint is available to registered partners only.",
        )
    return identity
