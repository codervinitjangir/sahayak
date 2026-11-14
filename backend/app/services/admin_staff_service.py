"""Staff accounts, roles and invites (ADR-029).

ADR-020 refused an admin link-auth endpoint because nothing tied the caller to
the row being claimed, and named the fix it did not build: a one-time
provisioning token. This is that token, with two properties the old link
endpoints lacked:

  * it is unguessable and single-use, stored only as a hash, and expires;
  * it is bound to a phone number, and accepting it requires a session whose
    *verified* phone claim is that number. Knowing the token is not enough, and
    neither is owning the number.

Every write records its audit row in the same transaction (ADR-024).
"""
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import admin_ops_repository, admin_staff_repository, auth_repository
from app.schemas.admin_staff import (
    StaffInvite,
    StaffInviteCreated,
    StaffListResponse,
    StaffMember,
)
from app.services.auth_service import Identity, TokenClaims
from app.utils.errors import (
    BadRequestError,
    ConflictError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
)
from app.utils.logging import log_event
from app.utils.phone import digits_only, same_number

INVITE_TTL = timedelta(hours=72)
SUPER_ADMIN = "super_admin"

# One message for every way an invite can fail to apply. Telling "expired" from
# "wrong number" from "no such token" would let a caller probe which tokens exist.
_INVITE_INVALID = "This invite is not valid. Ask for a new one."


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _member(admin, identity: Optional[Identity] = None) -> StaffMember:
    return StaffMember(
        id=admin.id, name=admin.name, role=admin.role, phone=getattr(admin, "phone", None),
        has_login=admin.auth_user_id is not None, disabled_at=getattr(admin, "disabled_at", None),
        created_at=getattr(admin, "created_at", None),
        is_you=identity is not None and admin.id == identity.local_id,
    )


def _invite(invite, now: datetime) -> StaffInvite:
    return StaffInvite(
        id=invite.id, name=invite.name, role=invite.role, phone=invite.phone,
        created_at=invite.created_at, expires_at=invite.expires_at, expired=invite.expires_at <= now,
    )


async def list_staff(db: AsyncSession, identity: Identity) -> StaffListResponse:
    now = datetime.now(timezone.utc)
    admins = await admin_staff_repository.list_admins(db)
    invites = await admin_staff_repository.open_invites(db)
    return StaffListResponse(
        staff=[_member(a, identity) for a in admins],
        invites=[_invite(i, now) for i in invites],
        your_role=identity.admin_role or "",
    )


async def create_invite(
    db: AsyncSession, identity: Identity, *, name: str, phone: str, role: str
) -> StaffInviteCreated:
    """Issue an invite. The token is returned here and never again."""
    existing = await admin_staff_repository.get_active_admin_by_phone_digits(db, digits_only(phone))
    if existing is not None:
        raise ConflictError(ErrorCode.STAFF_ALREADY_EXISTS, "A staff account already uses this number.")

    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    try:
        # A new invite replaces any open one for the same number, so a lost
        # token is fixed by inviting again rather than by two live tokens.
        for old in await admin_staff_repository.open_invites(db, phone=phone):
            old.revoked_at = func.now()
        await db.flush()
        invite = await admin_staff_repository.add_invite(
            db, token_hash=hash_token(token), phone=phone, name=name.strip(), role=role,
            created_by=identity.local_id, expires_at=now + INVITE_TTL,
        )
        invite_id, expires_at = invite.id, invite.expires_at
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="admin_invited", target_type="admin",
            target_id=invite_id, reason=None,
            details={"role": role, "phone_tail": digits_only(phone)[-4:]},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            ErrorCode.STAFF_ALREADY_EXISTS, "An invite for this number was created at the same moment. Try again."
        ) from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("admin_invite_failed", level=logging.ERROR, error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not create the invite") from exc

    log_event("admin_invited", admin_id=str(identity.local_id), invite_id=str(invite_id), role=role,
              outcome="success")
    return StaffInviteCreated(
        id=invite_id, name=name.strip(), role=role, phone=phone, created_at=now,
        expires_at=expires_at, expired=False, token=token,
    )


async def revoke_invite(db: AsyncSession, identity: Identity, invite_id: uuid.UUID) -> None:
    invite = await admin_staff_repository.get_invite_for_update(db, invite_id)
    if invite is None or invite.accepted_at is not None or invite.revoked_at is not None:
        await db.rollback()
        raise NotFoundError(ErrorCode.INVITE_INVALID, "No open invite with that id.")
    try:
        invite.revoked_at = func.now()
        await db.flush()
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="admin_invite_revoked", target_type="admin",
            target_id=invite_id, reason=None, details=None,
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        raise InternalError("Could not revoke the invite") from exc
    log_event("admin_invite_revoked", admin_id=str(identity.local_id), invite_id=str(invite_id), outcome="success")


def _reject_invite(reason: str, claims: TokenClaims) -> NotFoundError:
    log_event("admin_invite_rejected", level=logging.WARNING, auth_user_id=str(claims.auth_user_id),
              reason=reason, outcome="failure")
    return NotFoundError(ErrorCode.INVITE_INVALID, _INVITE_INVALID)


async def accept_invite(db: AsyncSession, claims: TokenClaims, token: str) -> StaffMember:
    """Turn a valid invite plus a matching verified phone into a staff account.

    Takes TokenClaims, not an Identity: the caller has a session and, by design,
    no local row yet. The invite row is locked first, so two accepts of one
    token serialise and the second finds it already used.
    """
    invite = await admin_staff_repository.get_invite_by_hash_for_update(db, hash_token(token))
    now = datetime.now(timezone.utc)
    reason = None
    if invite is None:
        reason = "no_such_token"
    elif invite.accepted_at is not None:
        reason = "already_used"
    elif invite.revoked_at is not None:
        reason = "revoked"
    elif invite.expires_at <= now:
        reason = "expired"
    elif not same_number(claims.phone, invite.phone):
        # The token leaked, or was sent to the wrong person. Same answer as a
        # token that does not exist.
        reason = "phone_claim_does_not_match_invite"
    if reason is not None:
        await db.rollback()
        raise _reject_invite(reason, claims)

    # ADR-020 (4): one Supabase account, at most one local row, across all three tables.
    if (
        await auth_repository.get_user_by_auth_id(db, claims.auth_user_id) is not None
        or await auth_repository.get_partner_by_auth_id(db, claims.auth_user_id) is not None
        or await auth_repository.get_admin_by_auth_id(db, claims.auth_user_id) is not None
    ):
        await db.rollback()
        log_event("admin_invite_rejected", level=logging.WARNING, auth_user_id=str(claims.auth_user_id),
                  reason="account_already_linked_elsewhere", outcome="failure")
        raise ConflictError(
            ErrorCode.AUTH_ALREADY_LINKED,
            "This number already has a Sahayak owner or partner profile. Staff accounts need a number of their own.",
        )

    try:
        admin = await admin_staff_repository.add_admin(
            db, name=invite.name, role=invite.role, phone=invite.phone,
            auth_user_id=claims.auth_user_id, invited_by=invite.created_by,
        )
        member = _member(admin)
        invite.accepted_at = func.now()
        invite.accepted_admin_id = admin.id
        await db.flush()
        await admin_ops_repository.add_audit(
            db, admin_id=admin.id, action="admin_invite_accepted", target_type="admin",
            target_id=admin.id, reason=None,
            details={"role": member.role, "invited_by": str(invite.created_by) if invite.created_by else None},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(ErrorCode.AUTH_ALREADY_LINKED, "This account is already linked to a Sahayak profile.") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("admin_invite_accept_failed", level=logging.ERROR, error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not accept the invite") from exc

    log_event("admin_invite_accepted", admin_id=str(member.id), role=member.role, outcome="success")
    return member.model_copy(update={"is_you": True})


async def update_staff(
    db: AsyncSession, identity: Identity, admin_id: uuid.UUID, *,
    role: Optional[str], disabled: Optional[bool], reason: str,
) -> StaffMember:
    """Change a staff member's role, or switch their access off or on.

    Two rules keep at least one working super admin at all times, without
    counting: nobody may change their own account, and the actor must still be
    an active super admin once the super-admin rows are locked. The target is
    then never the actor, so the actor always remains.
    """
    if role is None and disabled is None:
        raise BadRequestError("VALIDATION_ERROR", "Send a role, disabled, or both.")
    if admin_id == identity.local_id:
        raise ConflictError(
            ErrorCode.CANNOT_MODIFY_SELF, "You cannot change your own staff account. Ask another super admin."
        )

    supers = await admin_staff_repository.lock_active_super_admins(db)
    if not any(a.id == identity.local_id for a in supers):
        # Demoted or disabled by someone else between sign-in and this request.
        await db.rollback()
        raise ForbiddenError(ErrorCode.FORBIDDEN, "Your account can no longer manage staff.")

    target = await admin_staff_repository.get_admin_for_update(db, admin_id)
    if target is None:
        await db.rollback()
        raise NotFoundError(ErrorCode.STAFF_NOT_FOUND, "Staff member not found")

    from_role, was_disabled = target.role, target.disabled_at is not None
    to_role = role if role is not None else from_role
    to_disabled = disabled if disabled is not None else was_disabled
    if to_role == from_role and to_disabled == was_disabled:
        member = _member(target, identity)
        await db.rollback()
        return member

    try:
        target.role = to_role
        if to_disabled and not was_disabled:
            target.disabled_at = datetime.now(timezone.utc)
        elif not to_disabled:
            target.disabled_at = None
        await db.flush()
        await admin_ops_repository.add_audit(
            db, admin_id=identity.local_id, action="admin_updated", target_type="admin",
            target_id=admin_id, reason=reason,
            details={"from_role": from_role, "to_role": to_role,
                     "was_disabled": was_disabled, "disabled": to_disabled},
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event("admin_update_failed", level=logging.ERROR, error_type=type(exc).__name__, outcome="failure")
        raise InternalError("Could not update the staff member") from exc

    await db.refresh(target)
    log_event("admin_updated", admin_id=str(identity.local_id), target_admin_id=str(admin_id),
              to_role=to_role, disabled=to_disabled, outcome="success")
    return _member(target, identity)
