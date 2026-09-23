"""
Business logic for vehicle-owner registration.

Mirrors app/services/partner_service.py: the route handler in app/api/users.py
stays thin, every database call goes through app/repositories/user_repository,
and this module owns the rules, the transaction boundary and the error mapping.

Authorization model, and why it differs from register_partner:

  * register_partner is unauthenticated, because a mechanic is onboarded in
    person by ops — often over the phone, before that mechanic has ever opened
    an app. The profile it creates is inert (unverified, off-shift, bound to no
    account), so an open endpoint creates junk rows at worst.
  * register_user requires a verified token, because a vehicle owner's profile
    is *not* inert: it is created already bound to the caller's Supabase
    account, and it can request jobs from the moment it exists. It uses
    get_token_claims rather than get_current_identity for the obvious reason —
    at registration no local row exists yet, so requiring one would be circular.

That difference is also why this is one round trip and partner signup is two.
A partner registers, then link-auth binds them later, because the two events
genuinely happen at different times and by different people. An owner does both
in the same moment: they have just passed OTP, they are holding the token, and
there is nobody else involved. POST /users/{id}/link-auth still exists for the
case this path does not cover — a users row that arrived by some other route
(a data migration, db/seed.sql) and needs binding after the fact.
"""
import logging
import time
from typing import Optional

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories import auth_repository, user_repository
from app.schemas.user import UserRegisterRequest
from app.services.auth_service import TokenClaims
from app.utils.errors import (
    BadRequestError,
    ConflictError,
    ErrorCode,
    InternalError,
)
from app.utils.logging import log_event


def _digits(value: Optional[str]) -> str:
    """Reduce a phone number to its digits, for comparison only.

    Supabase reports the phone claim without a leading '+' ("919000000801")
    while the schema stores E.164 ("+919000000801"), so the two never compare
    equal as strings even when they are the same number. Stripping to digits is
    the smallest normalisation that makes them comparable without inventing a
    phone-number library's worth of parsing.

    Deliberately *not* used to rewrite what gets stored. The row keeps exactly
    what the client sent, so the database holds one canonical format that the
    client chose rather than a stripped variant this function invented.
    """
    return "".join(character for character in (value or "") if character.isdigit())


async def register_user(
    db: AsyncSession, payload: UserRegisterRequest, claims: TokenClaims
) -> User:
    """Create a vehicle owner's profile, already bound to their Supabase account.

    This is the call that closes the gap the auth module left behind: before it,
    nothing in the API created a `users` row, so a brand-new owner could pass
    OTP, hold a perfectly valid token, and still be refused by every endpoint
    forever. See ADR-011.

    Steps, in order:
      1. The phone number must not already be registered. phone is unique in the
         schema, so this is checked rather than left to the constraint: a caller
         deserves "this number is already registered" and not a raw database
         error. Same for email when one is supplied, which is also unique.
      2. The caller's Supabase account must not already own a profile — user or
         partner. Without this, a mechanic could grow a second, owner-shaped
         identity on the same credential, and resolve_identity would then refuse
         them *both* roles as ambiguous.
      3. The submitted number must be the number the token proves. See below.
      4. Insert, with auth_user_id set in the same statement. Registration is
         therefore atomic: there is no moment at which an unowned users row
         exists.

    On phone_verified — the spec for this endpoint said to set it true
    unconditionally, on the reasoning that Supabase already verified the number
    via OTP to get this far. That reasoning is right about the token and wrong
    about the body: Supabase verified the number in the *token*, and nothing
    yet connected that to the number in the *request*. Set true unconditionally,
    the flag would mean "the client asserted this", and the failure is not
    theoretical — `users.phone` is UNIQUE, so anyone holding any valid session
    could register a stranger's number as verified and permanently lock its real
    owner out of the platform.

    So the flag records what was actually proved:

      * token carries a phone claim, and it matches  -> stored true
      * token carries a phone claim, and it differs  -> 400 PHONE_MISMATCH
      * token carries no phone claim at all          -> stored false

    The third case is not hypothetical — a Supabase project can issue tokens for
    email or OAuth sign-ins, which carry no phone. Refusing those would block a
    legitimate signup over a claim we never required; recording false is honest
    and leaves the row correctable later. This is a consistency check between two
    things already in hand, not the independent OTP verification the spec ruled
    out.

    Raises:
        BadRequestError (400): phone or email already registered, or the number
            does not match the token's.
        ConflictError (409): this Supabase account already owns a profile.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    def _elapsed_ms() -> float:
        return round((time.perf_counter() - started) * 1000, 2)

    def _reject(outcome: str) -> None:
        # phone, email and name are all redacted by log_event — this line records
        # that a registration was refused and why, not who was refusing.
        log_event(
            "user_registered",
            level=logging.WARNING,
            actor_role="user",
            auth_user_id=str(claims.auth_user_id),
            outcome=outcome,
            duration_ms=_elapsed_ms(),
        )

    existing = await user_repository.get_user_by_phone(db, payload.phone)
    if existing is not None:
        _reject("rejected_phone_already_registered")
        raise BadRequestError(
            ErrorCode.USER_ALREADY_EXISTS,
            "A user is already registered with this phone number",
        )

    if payload.email is not None:
        existing_email = await user_repository.get_user_by_email(db, payload.email)
        if existing_email is not None:
            _reject("rejected_email_already_registered")
            raise BadRequestError(
                ErrorCode.USER_ALREADY_EXISTS,
                "A user is already registered with this email address",
            )

    # Checked before the write so the caller gets a clear 409 instead of a 500
    # from the UNIQUE violation on auth_user_id. The constraint is still the real
    # guarantee — this only improves the error.
    linked_user = await auth_repository.get_user_by_auth_id(db, claims.auth_user_id)
    linked_partner = await auth_repository.get_partner_by_auth_id(
        db, claims.auth_user_id
    )
    if linked_user is not None or linked_partner is not None:
        _reject("rejected_account_already_linked")
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This account is already linked to a Sahayak profile.",
        )

    token_phone = _digits(claims.phone)
    if token_phone and token_phone != _digits(payload.phone):
        _reject("rejected_phone_does_not_match_token")
        raise BadRequestError(
            ErrorCode.PHONE_MISMATCH,
            "You can only register the phone number your account verified.",
        )
    phone_verified = bool(token_phone)

    try:
        user = await user_repository.create_user_row(
            db,
            name=payload.name,
            phone=payload.phone,
            email=payload.email,
            phone_verified=phone_verified,
            auth_user_id=claims.auth_user_id,
        )
        await db.commit()
    except IntegrityError as exc:
        # Two signups racing: the pre-checks above passed for both, a unique
        # index caught the loser. Which index is not worth distinguishing here —
        # every one of them (phone, email, auth_user_id) means the same thing to
        # the caller, that someone got there first, and re-querying to find out
        # which would be three round trips on a path that is already lost.
        await db.rollback()
        _reject("rejected_duplicate_race")
        raise BadRequestError(
            ErrorCode.USER_ALREADY_EXISTS,
            "A user is already registered with these details",
        ) from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "user_registered",
            level=logging.ERROR,
            actor_role="user",
            auth_user_id=str(claims.auth_user_id),
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=_elapsed_ms(),
        )
        raise InternalError("Could not register user") from exc

    # created_at is a database default, so re-read the row to return what
    # Postgres actually stored rather than a value this process guessed.
    await db.refresh(user)

    log_event(
        "user_registered",
        user_id=str(user.id),
        auth_user_id=str(claims.auth_user_id),
        phone_verified=user.phone_verified,
        actor_role="user",
        outcome="success",
        duration_ms=_elapsed_ms(),
    )
    return user
