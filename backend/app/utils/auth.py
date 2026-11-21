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

from fastapi import Depends, Header
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
    x_sahayak_profile: Optional[str] = Header(default=None),
) -> Identity:
    """The caller's verified identity, resolved to one of our own rows.

    This is the dependency to reach for by default. It answers "who is this" in
    terms the domain can use — a users.id or a partners.id — so a handler never
    has to take the client's word for it.
    """
    # The header only chooses among profiles this token already owns (ADR-034).
    return await resolve_identity(db, claims, preferred_role=x_sahayak_profile)


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


async def require_admin(
    identity: Identity = Depends(get_current_identity),
) -> Identity:
    """Identity, restricted to platform admins.

    For the analytics endpoints, which read across every partner and every job
    in the system. Unlike require_user and require_partner there is no
    corresponding ownership check to follow it: an admin's local_id scopes
    nothing, because the whole point of these routes is that they are not
    scoped. This dependency is therefore the entire authorization boundary, and
    a route that forgets it is wide open to any logged-in customer rather than
    merely over-scoped.

    Admin is a role in the same sense the other two are — a row in one of our
    tables with a Supabase account attached (ADR-020) — so nothing here reads a
    claim. The `role` column on admins ('ops' vs 'super_admin') is not consulted
    either: it grades admins against each other and no endpoint yet distinguishes
    them, so checking it would be a check nothing could fail.
    """
    if identity.role != "admin":
        raise ForbiddenError(
            code=ErrorCode.FORBIDDEN,
            message="This endpoint is available to platform administrators only.",
        )
    return identity


# Which staff roles may perform which kind of WRITE (ADR-029). Reads are open to
# every staff role through require_admin; this table is the whole of the
# difference between the roles, in one place a reviewer can read.
STAFF_WRITE_ROLES: dict[str, tuple[str, ...]] = {
    "staff": ("super_admin",),                         # invites, roles, switching access off
    "jobs": ("super_admin", "ops", "support"),         # staff cancel
    "partners": ("super_admin", "ops"),                # verification
    "documents": ("super_admin", "ops"),               # view and review partner documents (ADR-038)
    "owners": ("super_admin", "ops"),                  # suspend / reinstate
    "disputes": ("super_admin", "ops", "support", "finance"),
    "refunds": ("super_admin", "finance"),             # a dispute resolved as refunded
    "pricing": ("super_admin", "finance"),             # catalogue base prices
    "care": ("super_admin", "ops"),                    # grant / end Sahayak Care (ADR-051)
}


def staff_may(identity: Identity, area: str) -> bool:
    return identity.role == "admin" and identity.admin_role in STAFF_WRITE_ROLES[area]


def require_staff(area: str):
    """Dependency: an admin whose role may write in `area`.

    The lookup happens here, when the route is declared, so a misspelt area is a
    KeyError at import rather than a route that silently admits nobody or
    everybody. An admin with no role on record is refused.
    """
    allowed = STAFF_WRITE_ROLES[area]

    async def dependency(identity: Identity = Depends(get_current_identity)) -> Identity:
        if identity.role != "admin" or identity.admin_role not in allowed:
            raise ForbiddenError(
                code=ErrorCode.FORBIDDEN,
                message="Your staff role does not allow this action.",
            )
        return identity

    return dependency
