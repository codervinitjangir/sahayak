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
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories import auth_repository, user_repository
from app.schemas.user import UserRegisterRequest
from app.services import auth_service
from app.services.auth_service import TokenClaims
from app.utils.errors import (
    BadRequestError,
    ConflictError,
    ErrorCode,
    InternalError,
    NotFoundError,
)
from app.utils.logging import log_event
from app.utils.phone import digits_only


def _digits(value: Optional[str]) -> str:
    """Reduce a phone number to its digits, for comparison only.

    Thin alias over app/utils/phone.digits_only, which is where this moved when
    both link-auth endpoints started needing the same comparison. Kept as a name
    in this module because the call sites below read better for it.
    """
    return digits_only(value)


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
    #
    # Except for admins, where it is the only guarantee there is: users'
    # auth_user_id index knows nothing about the admins table, so without this
    # an admin's account could register a customer profile and land in the
    # two-table state resolve_identity answers with a 500 — permanently, for
    # every request that account makes afterwards. See ADR-020.
    linked_user = await auth_repository.get_user_by_auth_id(db, claims.auth_user_id)
    linked_admin = await auth_repository.get_admin_by_auth_id(db, claims.auth_user_id)
    # A partner may also become an owner on the same login (ADR-034).
    if linked_user is not None or linked_admin is not None:
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


# ---------------------------------------------------------------------------
# Self-service profile, export and deletion (G8 / G10, ADR-025)
# ---------------------------------------------------------------------------

async def _me(db: AsyncSession, user_id) -> User:
    user = await user_repository.get_user_by_id(db, user_id)
    if user is None or getattr(user, "deleted_at", None) is not None:
        raise NotFoundError(ErrorCode.USER_NOT_FOUND, "User not found")
    return user


async def get_me(db: AsyncSession, user_id) -> User:
    return await _me(db, user_id)


async def update_me(db: AsyncSession, user_id, *, name: Optional[str], email: Optional[str], email_set: bool) -> User:
    """Edit name and email. Phone is the login and is not editable here.

    `email_set` distinguishes "leave email alone" (field absent) from "clear
    it" (explicit null).
    """
    user = await _me(db, user_id)
    fields: dict = {}
    if name is not None:
        fields["name"] = name.strip()
    if email_set:
        new_email = email.strip().lower() if email else None
        if new_email and new_email != (user.email or "").lower():
            other = await user_repository.get_user_by_email(db, new_email)
            if other is not None and other.id != user.id:
                raise BadRequestError(
                    ErrorCode.USER_ALREADY_EXISTS, "Another account already uses this email address"
                )
        fields["email"] = new_email
    if not fields:
        return user
    try:
        await user_repository.update_user_fields(db, user, **fields)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise BadRequestError(
            ErrorCode.USER_ALREADY_EXISTS, "Another account already uses this email address"
        ) from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not update your profile") from exc
    log_event("user_profile_updated", user_id=str(user_id), fields=",".join(sorted(fields)), outcome="success")
    return await _me(db, user_id)


def _iso(value):
    return value.isoformat() if value is not None else None


def _num(value):
    return float(value) if value is not None else None


async def export_me(db: AsyncSession, user_id) -> dict:
    """Everything Sahayak stores about this owner, as plain JSON (G10).

    Partner contact details are not included: a partner's phone is the
    partner's personal data, not the owner's.
    """
    user = await _me(db, user_id)
    rows = await user_repository.export_rows(db, user.id)
    history_by_job: dict = {}
    for h in rows["history"]:
        history_by_job.setdefault(h.job_id, []).append(
            {"status": h.status, "at": _iso(h.changed_at), "note": h.note})
    payments_by_job: dict = {}
    for pay in rows["payments"]:
        payments_by_job.setdefault(pay.job_id, []).append({
            "amount": _num(pay.amount), "status": pay.status,
            "method": pay.payment_method, "at": _iso(pay.created_at),
        })
    ratings_by_job: dict = {}
    for r in rows["ratings"]:
        ratings_by_job.setdefault(r.job_id, []).append(
            {"by": r.rated_by, "rating": r.rating, "comment": r.comment})
    log_event("user_data_exported", user_id=str(user_id), jobs=len(rows["jobs"]), outcome="success")
    return {
        "exported_at": _iso(datetime.now(timezone.utc)),
        "profile": {
            "id": str(user.id), "name": user.name, "phone": user.phone, "email": user.email,
            "created_at": _iso(user.created_at),
        },
        "vehicles": [
            {"id": str(v.id), "type": v.vehicle_type, "make": v.make, "model": v.model,
             "vehicle_number": v.vehicle_number, "created_at": _iso(v.created_at)}
            for v in rows["vehicles"]
        ],
        "jobs": [
            {"id": str(j.id), "status": j.status, "service_id": j.service_id,
             "vehicle_number": j.vehicle_number, "pickup_address_text": j.pickup_address_text,
             "issue_description": j.issue_description, "price_estimate": _num(j.price_estimate),
             "price_final": _num(j.price_final), "requested_at": _iso(j.requested_at),
             "completed_at": _iso(j.completed_at), "cancelled_at": _iso(j.cancelled_at),
             "cancellation_reason": j.cancellation_reason, "timeline": history_by_job.get(j.id, []),
             "payments": payments_by_job.get(j.id, []), "ratings": ratings_by_job.get(j.id, [])}
            for j in rows["jobs"]
        ],
        "notifications": [
            {"event": n.event, "message": n.message, "read": bool(n.is_read), "at": _iso(n.sent_at)}
            for n in rows["notifications"]
        ],
    }


async def delete_me(db: AsyncSession, user_id, auth_user_id) -> None:
    """Delete the owner's account (ADR-025): anonymise, do not remove.

    Refused with 409 ACCOUNT_HAS_ACTIVE_JOB while a request is live: someone
    may be driving to them. Otherwise, in one transaction: free text on their
    jobs and their rating comments erased, vehicles and notifications deleted,
    and the users row rewritten so it identifies nobody and no login resolves
    to it. Jobs and payments stay, because partners' earnings and the payment
    record point at them.

    The Supabase login is deleted afterwards, best-effort: if that call fails
    the token still reaches nothing, because auth_user_id is gone from every
    table and the phone no longer matches for re-linking.
    """
    user = await _me(db, user_id)
    if await user_repository.count_active_jobs(db, user.id) > 0:
        raise ConflictError(
            ErrorCode.ACCOUNT_HAS_ACTIVE_JOB,
            "Finish or cancel your active request before deleting your account",
        )
    user_pk = user.id
    try:
        await user_repository.erase_owner_data(db, user_pk)
        await user_repository.update_user_fields(
            db, user,
            name="Deleted user",
            # 15 chars, unique, never dialable: 'del' + 12 hex of the id.
            phone="del" + user_pk.hex[:12],
            email=None,
            auth_user_id=None,
            phone_verified=False,
            deleted_at=func.now(),
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("user_account_delete_failed", level=logging.ERROR, user_id=str(user_pk),
                  error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not delete your account") from exc

    log_event("user_account_deleted", user_id=str(user_pk), outcome="success")
    await auth_service.delete_supabase_user(auth_user_id)
