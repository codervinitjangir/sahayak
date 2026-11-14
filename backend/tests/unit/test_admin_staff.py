"""ADR-029: staff roles, invites, and the guards around them."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.models.admin import Admin
from app.models.admin_invite import AdminInvite
from app.schemas.admin_staff import StaffInviteRequest, StaffUpdateRequest
from app.services import admin_staff_service, auth_service
from app.services.auth_service import Identity, TokenClaims
from app.utils import auth as auth_utils
from app.utils.errors import AppError, ForbiddenError

SUPER = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.uuid4(), admin_role="super_admin")
PHONE = "+919000000831"
TOKEN = "t" * 43


def _invite(**kw):
    base = dict(id=uuid.uuid4(), token_hash=admin_staff_service.hash_token(TOKEN), phone=PHONE,
                name="Asha", role="support", created_by=SUPER.local_id,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                accepted_at=None, revoked_at=None)
    base.update(kw)
    return AdminInvite(**base)


def _claims(phone="919000000831"):
    return TokenClaims(auth_user_id=uuid.uuid4(), phone=phone)


def _no_existing_rows():
    return (
        patch("app.repositories.auth_repository.get_user_by_auth_id", AsyncMock(return_value=None)),
        patch("app.repositories.auth_repository.get_partner_by_auth_id", AsyncMock(return_value=None)),
        patch("app.repositories.auth_repository.get_admin_by_auth_id", AsyncMock(return_value=None)),
    )


# --- role gate ---------------------------------------------------------------
@pytest.mark.parametrize("area,role,allowed", [
    ("staff", "super_admin", True), ("staff", "ops", False), ("staff", "finance", False),
    ("pricing", "finance", True), ("pricing", "ops", False), ("pricing", "support", False),
    ("partners", "ops", True), ("partners", "support", False), ("partners", "finance", False),
    ("owners", "support", False), ("jobs", "support", True), ("jobs", "finance", False),
    ("refunds", "finance", True), ("refunds", "support", False), ("disputes", "support", True),
])
@pytest.mark.asyncio
async def test_each_write_area_admits_only_its_roles(area, role, allowed):
    identity = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.uuid4(), admin_role=role)
    dep = auth_utils.require_staff(area)
    if allowed:
        assert await dep(identity) is identity
    else:
        with pytest.raises(ForbiddenError):
            await dep(identity)


@pytest.mark.asyncio
async def test_role_gate_refuses_non_admins_and_admins_with_no_role():
    for identity in (
        Identity(auth_user_id=uuid.uuid4(), role="user", local_id=uuid.uuid4()),
        Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.uuid4(), admin_role=None),
    ):
        with pytest.raises(ForbiddenError):
            await auth_utils.require_staff("jobs")(identity)


def test_an_unknown_area_fails_at_import_time_not_at_request_time():
    with pytest.raises(KeyError):
        auth_utils.require_staff("no_such_area")


# --- identity resolution -----------------------------------------------------
@pytest.mark.asyncio
async def test_resolved_admin_carries_its_role():
    admin = Admin(id=uuid.uuid4(), role="finance", auth_user_id=uuid.uuid4())
    with patch("app.repositories.auth_repository.get_user_by_auth_id", AsyncMock(return_value=None)), \
         patch("app.repositories.auth_repository.get_partner_by_auth_id", AsyncMock(return_value=None)), \
         patch("app.repositories.auth_repository.get_admin_by_auth_id", AsyncMock(return_value=admin)):
        identity = await auth_service.resolve_identity(AsyncMock(), MagicMock(auth_user_id=admin.auth_user_id))
    assert identity.role == "admin" and identity.admin_role == "finance"


@pytest.mark.asyncio
async def test_disabled_admin_is_refused_at_identity_resolution():
    admin = Admin(id=uuid.uuid4(), role="super_admin", auth_user_id=uuid.uuid4(),
                  disabled_at=datetime.now(timezone.utc))
    with patch("app.repositories.auth_repository.get_user_by_auth_id", AsyncMock(return_value=None)), \
         patch("app.repositories.auth_repository.get_partner_by_auth_id", AsyncMock(return_value=None)), \
         patch("app.repositories.auth_repository.get_admin_by_auth_id", AsyncMock(return_value=admin)):
        with pytest.raises(ForbiddenError) as exc:
            await auth_service.resolve_identity(AsyncMock(), MagicMock(auth_user_id=admin.auth_user_id))
    assert exc.value.code == "ACCOUNT_SUSPENDED"


# --- accepting an invite -----------------------------------------------------
async def _accept(invite, claims):
    db = AsyncMock()
    p1, p2, p3 = _no_existing_rows()
    created = Admin(id=uuid.uuid4(), name="Asha", role="support", phone=PHONE, auth_user_id=claims.auth_user_id)
    with patch("app.repositories.admin_staff_repository.get_invite_by_hash_for_update", AsyncMock(return_value=invite)), \
         patch("app.repositories.admin_staff_repository.add_admin", AsyncMock(return_value=created)) as add, \
         patch("app.repositories.admin_ops_repository.add_audit", AsyncMock()) as audit, p1, p2, p3:
        out = await admin_staff_service.accept_invite(db, claims, TOKEN)
    return out, add, audit, db


@pytest.mark.asyncio
async def test_valid_token_and_matching_phone_creates_the_admin_once():
    invite = _invite()
    out, add, audit, db = await _accept(invite, _claims())
    assert out.role == "support" and out.is_you
    assert add.await_args.kwargs["role"] == "support" and add.await_args.kwargs["phone"] == PHONE
    assert invite.accepted_admin_id is not None and invite.accepted_at is not None
    assert audit.await_args.kwargs["action"] == "admin_invite_accepted"
    db.commit.assert_awaited_once()


@pytest.mark.parametrize("invite_kw,claims_phone", [
    ({"accepted_at": datetime.now(timezone.utc)}, "919000000831"),                    # already used
    ({"revoked_at": datetime.now(timezone.utc)}, "919000000831"),                     # revoked
    ({"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}, "919000000831"),  # expired
    ({}, "919000000832"),                                                             # someone else's number
    ({}, None),                                                                       # no phone claim at all
])
@pytest.mark.asyncio
async def test_every_invalid_invite_gets_the_same_404_and_creates_nothing(invite_kw, claims_phone):
    with pytest.raises(AppError) as exc:
        await _accept(_invite(**invite_kw), _claims(claims_phone))
    assert exc.value.status_code == 404 and exc.value.code == "INVITE_INVALID"


@pytest.mark.asyncio
async def test_unknown_token_is_the_same_404():
    with patch("app.repositories.admin_staff_repository.get_invite_by_hash_for_update", AsyncMock(return_value=None)):
        with pytest.raises(AppError) as exc:
            await admin_staff_service.accept_invite(AsyncMock(), _claims(), "x" * 43)
    assert exc.value.status_code == 404 and exc.value.code == "INVITE_INVALID"


@pytest.mark.parametrize("which", ["user", "partner", "admin"])
@pytest.mark.asyncio
async def test_an_account_that_already_owns_a_profile_cannot_also_become_staff(which):
    getters = {k: AsyncMock(return_value=None) for k in ("user", "partner", "admin")}
    getters[which] = AsyncMock(return_value=MagicMock())
    with patch("app.repositories.admin_staff_repository.get_invite_by_hash_for_update", AsyncMock(return_value=_invite())), \
         patch("app.repositories.admin_staff_repository.add_admin", AsyncMock()) as add, \
         patch("app.repositories.auth_repository.get_user_by_auth_id", getters["user"]), \
         patch("app.repositories.auth_repository.get_partner_by_auth_id", getters["partner"]), \
         patch("app.repositories.auth_repository.get_admin_by_auth_id", getters["admin"]):
        with pytest.raises(AppError) as exc:
            await admin_staff_service.accept_invite(AsyncMock(), _claims(), TOKEN)
    assert exc.value.status_code == 409 and exc.value.code == "AUTH_ALREADY_LINKED"
    add.assert_not_awaited()


def test_only_the_hash_of_a_token_is_ever_comparable():
    h = admin_staff_service.hash_token(TOKEN)
    assert len(h) == 64 and TOKEN not in h and h == admin_staff_service.hash_token(TOKEN)


# --- creating an invite ------------------------------------------------------
@pytest.mark.asyncio
async def test_invite_returns_a_token_but_stores_only_its_hash():
    db = AsyncMock()
    stored = {}

    async def add_invite(_db, **kw):
        stored.update(kw)
        return AdminInvite(id=uuid.uuid4(), **kw)

    with patch("app.repositories.admin_staff_repository.get_active_admin_by_phone_digits", AsyncMock(return_value=None)), \
         patch("app.repositories.admin_staff_repository.open_invites", AsyncMock(return_value=[])), \
         patch("app.repositories.admin_staff_repository.add_invite", add_invite), \
         patch("app.repositories.admin_ops_repository.add_audit", AsyncMock()) as audit:
        out = await admin_staff_service.create_invite(db, SUPER, name="Asha", phone=PHONE, role="support")
    assert len(out.token) >= 40
    assert stored["token_hash"] == admin_staff_service.hash_token(out.token) and out.token not in stored.values()
    # The audit row must not carry the token or the full number.
    details = audit.await_args.kwargs["details"]
    assert details == {"role": "support", "phone_tail": "0831"}


@pytest.mark.asyncio
async def test_inviting_a_number_that_is_already_staff_is_refused():
    with patch("app.repositories.admin_staff_repository.get_active_admin_by_phone_digits",
               AsyncMock(return_value=MagicMock())):
        with pytest.raises(AppError) as exc:
            await admin_staff_service.create_invite(AsyncMock(), SUPER, name="Asha", phone=PHONE, role="ops")
    assert exc.value.status_code == 409 and exc.value.code == "STAFF_ALREADY_EXISTS"


@pytest.mark.parametrize("bad", [
    {"name": "A", "phone": PHONE, "role": "ops"},
    {"name": "Asha", "phone": "9000000831", "role": "ops"},        # not E.164
    {"name": "Asha", "phone": PHONE, "role": "owner"},             # not a staff role
    {"name": "Asha", "phone": PHONE, "role": "ops", "auth_user_id": str(uuid.uuid4())},
])
def test_invite_request_validation(bad):
    with pytest.raises(ValidationError):
        StaffInviteRequest(**bad)


# --- changing a staff member -------------------------------------------------
def _actor_row():
    return Admin(id=SUPER.local_id, role="super_admin", auth_user_id=SUPER.auth_user_id)


@pytest.mark.asyncio
async def test_nobody_can_change_their_own_account():
    with pytest.raises(AppError) as exc:
        await admin_staff_service.update_staff(AsyncMock(), SUPER, SUPER.local_id,
                                               role="ops", disabled=None, reason="stepping down")
    assert exc.value.status_code == 409 and exc.value.code == "CANNOT_MODIFY_SELF"


@pytest.mark.asyncio
async def test_an_actor_who_lost_super_admin_since_signing_in_is_refused_under_lock():
    with patch("app.repositories.admin_staff_repository.lock_active_super_admins", AsyncMock(return_value=[])), \
         patch("app.repositories.admin_staff_repository.get_admin_for_update", AsyncMock()) as get_target:
        with pytest.raises(ForbiddenError):
            await admin_staff_service.update_staff(AsyncMock(), SUPER, uuid.uuid4(),
                                                   role=None, disabled=True, reason="race test")
    get_target.assert_not_awaited()


@pytest.mark.asyncio
async def test_disabling_writes_one_audit_row_with_before_and_after():
    target = Admin(id=uuid.uuid4(), name="Ravi", role="ops", auth_user_id=uuid.uuid4(), disabled_at=None)
    db = AsyncMock()
    with patch("app.repositories.admin_staff_repository.lock_active_super_admins", AsyncMock(return_value=[_actor_row()])), \
         patch("app.repositories.admin_staff_repository.get_admin_for_update", AsyncMock(return_value=target)), \
         patch("app.repositories.admin_ops_repository.add_audit", AsyncMock()) as audit:
        await admin_staff_service.update_staff(db, SUPER, target.id, role="support", disabled=True, reason="left the team")
    kw = audit.await_args.kwargs
    assert kw["action"] == "admin_updated" and kw["target_id"] == target.id and kw["reason"] == "left the team"
    assert kw["details"] == {"from_role": "ops", "to_role": "support", "was_disabled": False, "disabled": True}
    assert target.role == "support" and target.disabled_at is not None
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_no_op_update_writes_nothing():
    target = Admin(id=uuid.uuid4(), role="ops", auth_user_id=uuid.uuid4(), disabled_at=None)
    db = AsyncMock()
    with patch("app.repositories.admin_staff_repository.lock_active_super_admins", AsyncMock(return_value=[_actor_row()])), \
         patch("app.repositories.admin_staff_repository.get_admin_for_update", AsyncMock(return_value=target)), \
         patch("app.repositories.admin_ops_repository.add_audit", AsyncMock()) as audit:
        await admin_staff_service.update_staff(db, SUPER, target.id, role="ops", disabled=False, reason="no change")
    audit.assert_not_awaited()
    db.commit.assert_not_awaited()


def test_update_request_needs_a_reason_and_only_known_roles():
    with pytest.raises(ValidationError):
        StaffUpdateRequest(role="ops", reason="")
    with pytest.raises(ValidationError):
        StaffUpdateRequest(role="root", reason="because")
