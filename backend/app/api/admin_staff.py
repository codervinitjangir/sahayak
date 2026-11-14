"""Staff accounts, roles and invites (ADR-029).

Managing staff is super-admin only. Accepting an invite is the one route here
that takes token claims instead of an identity: the invitee has a session and,
by design, no local row yet.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.admin_staff import (
    StaffInviteAcceptRequest,
    StaffInviteCreated,
    StaffInviteRequest,
    StaffListResponse,
    StaffMember,
    StaffUpdateRequest,
)
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.services import admin_staff_service
from app.services.auth_service import Identity, TokenClaims
from app.utils.auth import get_token_claims, require_admin, require_staff

_ERROR_RESPONSES = {
    401: {"model": ErrorResponse}, 403: {"model": ErrorResponse},
    404: {"model": ErrorResponse}, 409: {"model": ErrorResponse},
}

admin_staff_router = APIRouter(
    prefix=f"{API_V1_PREFIX}/admin", tags=["admin staff"], responses=_ERROR_RESPONSES
)


@admin_staff_router.get(
    "/staff", response_model=ApiResponse[StaffListResponse],
    summary="Staff accounts and open invites",
)
async def list_staff(
    identity: Identity = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[StaffListResponse]:
    """Readable by every staff role, so anyone can see who to ask for access."""
    return envelope(await admin_staff_service.list_staff(db, identity))


@admin_staff_router.post(
    "/invites", response_model=ApiResponse[StaffInviteCreated], status_code=status.HTTP_201_CREATED,
    summary="Invite a staff member (super admin). Returns the token once",
)
async def create_invite(
    payload: StaffInviteRequest,
    identity: Identity = Depends(require_staff("staff")),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[StaffInviteCreated]:
    """409 STAFF_ALREADY_EXISTS if an active staff account uses the number. A new
    invite replaces any open invite for the same number. Valid for 72 hours."""
    return envelope(await admin_staff_service.create_invite(
        db, identity, name=payload.name, phone=payload.phone, role=payload.role))


@admin_staff_router.delete(
    "/invites/{invite_id}", response_model=ApiResponse[dict],
    summary="Revoke an open invite (super admin)",
)
async def revoke_invite(
    invite_id: uuid.UUID,
    identity: Identity = Depends(require_staff("staff")),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict]:
    await admin_staff_service.revoke_invite(db, identity, invite_id)
    return envelope({"revoked": True})


@admin_staff_router.post(
    "/invites/accept", response_model=ApiResponse[StaffMember],
    summary="Accept an invite with a session whose verified phone matches it",
)
async def accept_invite(
    payload: StaffInviteAcceptRequest,
    claims: TokenClaims = Depends(get_token_claims),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[StaffMember]:
    """404 INVITE_INVALID for an unknown, used, revoked or expired token and for a
    phone that does not match (one answer for all, on purpose). 409
    AUTH_ALREADY_LINKED if this account already has an owner or partner profile."""
    return envelope(await admin_staff_service.accept_invite(db, claims, payload.token))


@admin_staff_router.patch(
    "/staff/{admin_id}", response_model=ApiResponse[StaffMember],
    summary="Change a staff member's role or switch their access off/on (super admin, audited)",
)
async def update_staff(
    admin_id: uuid.UUID,
    payload: StaffUpdateRequest,
    identity: Identity = Depends(require_staff("staff")),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[StaffMember]:
    """409 CANNOT_MODIFY_SELF on your own account. A disabled member gets 403
    ACCOUNT_SUSPENDED on every request."""
    return envelope(await admin_staff_service.update_staff(
        db, identity, admin_id, role=payload.role, disabled=payload.disabled, reason=payload.reason))
