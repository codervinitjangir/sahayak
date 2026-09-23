"""
Auth rules: verify a Supabase token, resolve it to a local identity, link the two.

Supabase Auth owns the credential. It sends the phone OTP, it stores the
password-equivalent, and it signs the access token. This module never issues a
token and never sees an OTP — it only answers two questions about a token that
already exists:

  1. Is this genuine and current? (signature, expiry, audience, issuer)
  2. Whose row in *our* database does it correspond to?

Those are separate on purpose. A token can be perfectly valid and still have no
local identity behind it, which is exactly the state a brand-new signup is in
between "OTP verified" and "profile linked". Conflating the two would make that
state indistinguishable from an attack.

Layering matches the rest of the app: app/utils/auth.py holds the thin FastAPI
dependencies, every query goes through app/repositories/auth_repository.py, and
the rules, error mapping and transaction boundary live here.
"""
import logging
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, Optional

import jwt
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import get_settings
from app.models.partner import Partner
from app.models.user import User
from app.repositories import auth_repository, partner_repository
from app.utils.errors import (
    ConflictError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
    UnauthorizedError,
)
from app.utils.logging import log_event

Role = Literal["user", "partner"]

# How Supabase signs, and therefore how we verify.
#
# Current: ES256 over a P-256 keypair. Supabase holds the private half and
# publishes the public half at the project's JWKS endpoint, so this server can
# verify a signature it has no ability to produce. That asymmetry is the point —
# a leaked verification key forges nothing.
#
# Legacy: HS256 over a shared secret. Older projects used this, and Supabase
# keeps a rotated-out key valid until the tokens it signed expire, so a project
# mid-rotation has both in flight at once. Accepted only when the legacy secret
# is actually configured; blank means reject.
#
# Both lists are pinned server-side. The library's default is to trust whatever
# the token's own header asks for, which is the classic algorithm-confusion
# attack: declare alg="none", or swap ES256 for HS256 so the *public* key gets
# used as an HMAC secret — a value the attacker can read from the JWKS. The
# defence is not just naming the algorithms but binding each one to its own key
# material, which _select_verification_key below does.
_ASYMMETRIC_ALGORITHMS = ["ES256"]
_LEGACY_SYMMETRIC_ALGORITHMS = ["HS256"]

# How long a fetched JWKS stays good. Supabase rotation is a deliberate, rare
# act, and PyJWKClient re-fetches on an unknown kid anyway, so this only bounds
# how long a revoked key lingers.
_JWKS_CACHE_SECONDS = 300

# A few seconds of tolerance on exp/iat. Supabase's clock and ours are both NTP
# synced, but without any leeway a token that expires mid-flight produces a
# spurious 401 for a user who did nothing wrong. Small enough that it does not
# meaningfully extend a stolen token's life.
_CLOCK_SKEW_LEEWAY_SECONDS = 10


@lru_cache(maxsize=4)
def _jwk_client(jwks_url: str) -> jwt.PyJWKClient:
    """One JWKS client per URL, so keys are fetched once rather than per request.

    Cached on the URL rather than module-global so a test pointing at a local
    key set gets its own client instead of inheriting the production one.
    """
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=_JWKS_CACHE_SECONDS)


def _reject(reason: str) -> UnauthorizedError:
    """Log why a token failed, return a 401 that does not say."""
    log_event("auth_token_rejected", level=logging.WARNING, reason=reason, outcome="failure")
    return UnauthorizedError()


def _select_verification_key(token: str, settings) -> tuple[object, list[str]]:
    """Pick the key and the permitted algorithms from the token's declared alg.

    Reading the unverified header is safe here *because* the choice it drives is
    constrained: each branch pairs one algorithm with key material that only
    works for that algorithm. An attacker who rewrites the header to HS256 is
    routed to the legacy shared secret, which they do not have — never to the
    JWKS public key, which they could simply download. The header selects a
    lane; it cannot select a key it was not issued under.
    """
    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except jwt.InvalidTokenError as exc:
        raise _reject(type(exc).__name__)

    if alg in _ASYMMETRIC_ALGORITHMS:
        jwks_url = settings.SUPABASE_JWT_JWKS_URL
        if not jwks_url:
            log_event(
                "auth_misconfigured",
                level=logging.ERROR,
                reason="SUPABASE_URL is not set, so the JWKS endpoint is unknown",
                outcome="failure",
            )
            raise InternalError("Authentication is not configured on this server.")
        try:
            signing_key = _jwk_client(jwks_url).get_signing_key_from_jwt(token)
        except jwt.PyJWKClientConnectionError:
            # We could not reach the key set. That is our outage, not a bad
            # credential — saying 401 would tell a user with a perfectly good
            # session to log in again, which will not help them.
            log_event(
                "auth_jwks_unavailable",
                level=logging.ERROR,
                jwks_url=jwks_url,
                outcome="failure",
            )
            raise InternalError("Could not verify the token right now.")
        except (jwt.PyJWKClientError, jwt.PyJWKError, jwt.PyJWKSetError) as exc:
            # Reachable key set, no matching kid: a token from another project,
            # or signed by a key that has been revoked outright.
            raise _reject(type(exc).__name__)
        except jwt.InvalidTokenError as exc:
            # Not redundant with the decode below. get_signing_key_from_jwt
            # parses the *whole* token, not just the header, so a malformed
            # payload blows up here — before the code that was meant to turn
            # that into a 401 ever runs. Without this the caller gets a 500 for
            # sending garbage, which is both a lie and a free signal that they
            # found an unhandled path.
            raise _reject(type(exc).__name__)
        return signing_key.key, _ASYMMETRIC_ALGORITHMS

    if alg in _LEGACY_SYMMETRIC_ALGORITHMS:
        if not settings.SUPABASE_JWT_SECRET:
            # Not a misconfiguration — the expected state once a project has
            # finished migrating off shared secrets. Reject rather than 500.
            raise _reject("hs256_token_but_no_legacy_secret_configured")
        return settings.SUPABASE_JWT_SECRET, _LEGACY_SYMMETRIC_ALGORITHMS

    # Covers alg="none", RS256, and anything else a forger might try.
    raise _reject(f"disallowed_alg:{alg}")


@dataclass(frozen=True)
class Identity:
    """Who the caller is, after their token has been verified and resolved.

    Frozen because a route handler must not be able to edit the identity it was
    handed — an `identity.local_id = something_else` slip would be an
    authorization bypass that type checking would never catch.

    auth_user_id is Supabase's id; local_id is ours (users.id or partners.id).
    Keeping both means an endpoint can act on our own foreign keys without ever
    trusting the client, and still write the Supabase id into a log or an audit
    row when it needs to.
    """

    auth_user_id: uuid.UUID
    role: Role
    local_id: uuid.UUID


@dataclass(frozen=True)
class TokenClaims:
    """A verified token's contents, before any local lookup.

    This is the intermediate state that makes first-time linking possible: the
    caller has proved they hold a genuine Supabase session, but we do not yet
    know — and must not require — that a users or partners row points at them.
    """

    auth_user_id: uuid.UUID
    phone: Optional[str] = None
    email: Optional[str] = None


def decode_token(token: str) -> TokenClaims:
    """Verify a Supabase access token and return its identity claims.

    Raises UnauthorizedError for anything wrong with the token, with a message
    that deliberately does not say *what* was wrong. The real reason is logged
    instead: "signature failed" versus "expired" is useful to us and useful to
    someone probing for a token we will accept, and a legitimate client's next
    action is the same either way — re-authenticate.
    """
    settings = get_settings()

    key, algorithms = _select_verification_key(token, settings)

    options = {
        # Reject a token that omits either claim rather than treating a missing
        # exp as "never expires" or a missing sub as an anonymous caller.
        "require": ["exp", "sub"],
        "verify_exp": True,
        "verify_signature": True,
    }

    # Supabase stamps aud="authenticated" on every access token, and PyJWT
    # raises InvalidAudienceError when a token carries `aud` and the caller did
    # not say what it expects — so passing this is required for real tokens to
    # verify at all, not just extra hardening. Empty means "issuer has no aud".
    audience = settings.SUPABASE_JWT_AUDIENCE or None
    issuer = settings.SUPABASE_JWT_ISSUER or None
    if audience is None:
        options["verify_aud"] = False

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience=audience,
            issuer=issuer,
            leeway=_CLOCK_SKEW_LEEWAY_SECONDS,
            options=options,
        )
    except jwt.ExpiredSignatureError:
        log_event("auth_token_rejected", level=logging.WARNING, reason="expired", outcome="failure")
        raise UnauthorizedError("Token has expired.")
    except jwt.InvalidTokenError as exc:
        # Base class for every other PyJWT failure: bad signature, wrong
        # audience or issuer, malformed segments, missing required claim,
        # disallowed algorithm.
        raise _reject(type(exc).__name__)

    subject = payload.get("sub")
    try:
        auth_user_id = uuid.UUID(str(subject))
    except (TypeError, ValueError):
        # Supabase subjects are always UUIDs. Anything else means the token came
        # from somewhere we do not understand, and coercing it would let a
        # non-UUID string reach a UUID column comparison.
        raise _reject("sub_not_uuid")

    return TokenClaims(
        auth_user_id=auth_user_id,
        phone=payload.get("phone") or None,
        email=payload.get("email") or None,
    )


async def resolve_identity(db: AsyncSession, claims: TokenClaims) -> Identity:
    """Map a verified token onto the local row it owns.

    A given auth_user_id must exist in at most one of the two tables. The UNIQUE
    constraint on each column enforces "at most one row per table"; it cannot
    enforce "not in both", so that case is checked here and treated as a server
    fault rather than resolved by picking one. Silently preferring users over
    partners would hand whoever created the second row the other's permissions.

    When nothing matches, the caller gets one of two 403s — IDENTITY_NOT_LINKED
    if an unclaimed profile exists for their number, USER_NOT_REGISTERED if not.
    They are separate codes because the remedies are different endpoints, and a
    client cannot work out which applies from the outside. See ADR-011.
    """
    user = await auth_repository.get_user_by_auth_id(db, claims.auth_user_id)
    partner = await auth_repository.get_partner_by_auth_id(db, claims.auth_user_id)

    if user is not None and partner is not None:
        log_event(
            "auth_identity_ambiguous",
            level=logging.ERROR,
            auth_user_id=str(claims.auth_user_id),
            user_id=str(user.id),
            partner_id=str(partner.id),
            outcome="failure",
        )
        raise InternalError("Account is in an inconsistent state.")

    if user is not None:
        return Identity(auth_user_id=claims.auth_user_id, role="user", local_id=user.id)

    if partner is not None:
        return Identity(
            auth_user_id=claims.auth_user_id, role="partner", local_id=partner.id
        )

    # Authenticated, but no profile. Which of the two answers this is decides
    # what the client does next, so it is worth one extra query on a path that
    # has already failed.
    #
    # A profile may exist and simply not be bound yet: ops register a mechanic
    # by phone before that mechanic ever opens the app, so partners rows
    # routinely sit with auth_user_id NULL waiting for a link-auth call. The
    # token's own phone claim is the evidence that connects the two, and it is
    # evidence we can trust — Supabase put it there after verifying the number,
    # the caller did not.
    #
    # Everything else is somebody who passed OTP and never signed up.
    unlinked = await _find_unlinked_profile(db, claims.phone)
    if unlinked is not None:
        log_event(
            "auth_identity_not_linked",
            level=logging.WARNING,
            auth_user_id=str(claims.auth_user_id),
            profile_kind=unlinked,
            outcome="failure",
        )
        raise ForbiddenError(
            code=ErrorCode.IDENTITY_NOT_LINKED,
            message=(
                "This account is not linked to the Sahayak profile registered "
                "with your number. Call POST /api/v1/partners/{partner_id}/link-auth "
                "or POST /api/v1/users/{user_id}/link-auth first."
            ),
        )

    # 403 rather than 401, and this is the case where the distinction bites. The
    # token is genuine; re-authenticating produces an identical token and an
    # identical refusal. A client that reads 401 and returns the user to OTP
    # entry loops them forever — the remedy is a signup screen, which only a
    # distinct code can point at.
    log_event(
        "auth_user_not_registered",
        level=logging.WARNING,
        auth_user_id=str(claims.auth_user_id),
        outcome="failure",
    )
    raise ForbiddenError(
        code=ErrorCode.USER_NOT_REGISTERED,
        message=(
            "This account has been verified but has no Sahayak profile yet. "
            "Call POST /api/v1/users to complete registration."
        ),
    )


async def _find_unlinked_profile(
    db: AsyncSession, phone: Optional[str]
) -> Optional[Role]:
    """Is there an existing, unclaimed profile for this phone number?

    Returns "user"/"partner" when one exists, None otherwise — which is the
    difference between "call link-auth" and "sign up".

    Only reached when the caller has no identity, so it costs nothing on the
    normal path. A token with no phone claim (an email or OAuth sign-in) has
    nothing to search on and returns None, which is the right answer: with no
    evidence of an existing profile, signup is the correct next step.

    Matching on phone alone is safe *here* because it grants nothing. It selects
    which error message to show; the link-auth endpoints do their own checking
    before they bind anything, and they are the ones holding the authority.
    """
    if not phone:
        return None

    # Supabase reports the claim without a leading '+' while the schema stores
    # E.164, so both spellings are tried rather than normalising the column —
    # a function on phone would defeat its unique index, on the failure path of
    # every unregistered request.
    candidates = [phone, f"+{phone}"] if not phone.startswith("+") else [phone, phone[1:]]

    partner = await auth_repository.get_partner_by_phone_unlinked(db, candidates)
    if partner is not None:
        return "partner"

    user = await auth_repository.get_user_by_phone_unlinked(db, candidates)
    if user is not None:
        return "user"

    return None


async def link_partner_auth(
    db: AsyncSession, partner_id: uuid.UUID, claims: TokenClaims
) -> Partner:
    """Bind a verified Supabase account to a partner profile.

    Owns the transaction. Allowed only while partners.auth_user_id is null,
    which is the whole security property: an unlinked profile is unclaimed, and
    once claimed it cannot be taken over by presenting a different token.

    Re-linking the *same* account is treated as success rather than a conflict.
    A client that retries after a dropped response should not get an error for a
    request that already did what it asked.
    """
    partner = await partner_repository.get_partner_by_id(db, partner_id)
    if partner is None:
        raise NotFoundError(ErrorCode.PARTNER_NOT_FOUND, "Partner not found")

    if partner.auth_user_id is not None:
        if partner.auth_user_id == claims.auth_user_id:
            return partner
        log_event(
            "auth_link_rejected",
            level=logging.WARNING,
            partner_id=str(partner_id),
            reason="already_linked_to_other_account",
            outcome="failure",
        )
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This partner profile is already linked to a different account.",
        )

    # Checked before the write so the caller gets a clear 409 instead of a 500
    # from the UNIQUE violation. The constraint is still the real guarantee —
    # this only improves the error, and the IntegrityError below covers the race.
    existing_partner = await auth_repository.get_partner_by_auth_id(
        db, claims.auth_user_id
    )
    existing_user = await auth_repository.get_user_by_auth_id(db, claims.auth_user_id)
    if existing_partner is not None or existing_user is not None:
        log_event(
            "auth_link_rejected",
            level=logging.WARNING,
            partner_id=str(partner_id),
            reason="account_already_linked_elsewhere",
            outcome="failure",
        )
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This account is already linked to another Sahayak profile.",
        )

    try:
        await auth_repository.set_partner_auth_id(db, partner, claims.auth_user_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This account is already linked to another Sahayak profile.",
        )
    except SQLAlchemyError:
        await db.rollback()
        raise InternalError("Could not link account")

    await db.refresh(partner)
    log_event(
        "partner_auth_linked",
        partner_id=str(partner.id),
        auth_user_id=str(claims.auth_user_id),
        outcome="success",
    )
    return partner


async def link_user_auth(
    db: AsyncSession, user_id: uuid.UUID, claims: TokenClaims
) -> User:
    """Bind a verified Supabase account to a vehicle-owner profile.

    Mirror of link_partner_auth. Note what this is *not*: it does not create the
    users row, so it is not registration. See the module note in
    app/api/users.py for the gap that leaves.
    """
    user = await auth_repository.get_user_by_id(db, user_id)
    if user is None:
        raise NotFoundError(ErrorCode.USER_NOT_FOUND, "User not found")

    if user.auth_user_id is not None:
        if user.auth_user_id == claims.auth_user_id:
            return user
        log_event(
            "auth_link_rejected",
            level=logging.WARNING,
            user_id=str(user_id),
            reason="already_linked_to_other_account",
            outcome="failure",
        )
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This user profile is already linked to a different account.",
        )

    existing_user = await auth_repository.get_user_by_auth_id(db, claims.auth_user_id)
    existing_partner = await auth_repository.get_partner_by_auth_id(
        db, claims.auth_user_id
    )
    if existing_user is not None or existing_partner is not None:
        log_event(
            "auth_link_rejected",
            level=logging.WARNING,
            user_id=str(user_id),
            reason="account_already_linked_elsewhere",
            outcome="failure",
        )
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This account is already linked to another Sahayak profile.",
        )

    try:
        await auth_repository.set_user_auth_id(db, user, claims.auth_user_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This account is already linked to another Sahayak profile.",
        )
    except SQLAlchemyError:
        await db.rollback()
        raise InternalError("Could not link account")

    await db.refresh(user)
    log_event(
        "user_auth_linked",
        user_id=str(user.id),
        auth_user_id=str(claims.auth_user_id),
        outcome="success",
    )
    return user
