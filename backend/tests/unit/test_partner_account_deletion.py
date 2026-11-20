"""ADR-045: partner account deletion, the shared-login rule, and response headers."""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.middlewares.security_headers import SecurityHeadersMiddleware
from app.models.partner import Partner
from app.models.user import User
from app.repositories import partner_repository
from app.services import auth_service, partner_service, user_service
from app.services.auth_service import Identity
from app.utils.errors import ConflictError


def _partner(**kw) -> Partner:
    base = dict(id=uuid.uuid4(), name="Ravi Kumar", phone="+919000000123",
                verification_status="verified", is_available=True, auth_user_id=uuid.uuid4())
    base.update(kw)
    return Partner(**base)


def _identity(p: Partner) -> Identity:
    return Identity(auth_user_id=p.auth_user_id, role="partner", local_id=p.id)


# --- the shared-login rule (ADR-034 + ADR-045) ---------------------------------

@pytest.mark.asyncio
async def test_deleting_the_owner_profile_keeps_a_login_the_partner_profile_still_uses():
    """Regression: owner delete_me used to delete the Supabase login outright,
    signing the same person's partner profile out for good."""
    me = User(id=uuid.uuid4(), name="Asha", phone="+919000000001", created_at=datetime.now(timezone.utc))
    remove_login = AsyncMock(return_value=True)
    with patch("app.repositories.user_repository.get_user_by_id", AsyncMock(return_value=me)), \
         patch("app.repositories.user_repository.count_active_jobs", AsyncMock(return_value=0)), \
         patch("app.repositories.user_repository.erase_owner_data", AsyncMock()), \
         patch("app.repositories.user_repository.update_user_fields", AsyncMock()), \
         patch("app.services.auth_service.auth_user_still_used", AsyncMock(return_value=True), create=True), \
         patch("app.services.auth_service.delete_supabase_user", remove_login):
        await user_service.delete_me(AsyncMock(), me.id, "auth-shared")
    remove_login.assert_not_awaited()


@pytest.mark.asyncio
async def test_login_is_deleted_when_no_profile_uses_it():
    remove = AsyncMock(return_value=True)
    with patch.object(auth_service, "auth_user_still_used", AsyncMock(return_value=False)), \
         patch.object(auth_service, "delete_supabase_user", remove):
        assert await auth_service.delete_login_if_unused(AsyncMock(), "auth-1") is True
    remove.assert_awaited_once_with("auth-1")


@pytest.mark.asyncio
async def test_no_login_means_nothing_to_check():
    assert await auth_service.auth_user_still_used(AsyncMock(), None) is False


# --- partner delete_me ---------------------------------------------------------

@pytest.mark.asyncio
async def test_partner_with_live_work_cannot_delete():
    p = _partner()
    erase = AsyncMock()
    with patch.object(partner_repository, "get_partner_by_id", AsyncMock(return_value=p)), \
         patch.object(partner_repository, "count_live_work", AsyncMock(return_value=1)), \
         patch.object(partner_repository, "erase_partner_data", erase):
        with pytest.raises(ConflictError) as exc:
            await partner_service.delete_me(AsyncMock(), _identity(p))
    assert exc.value.code == "ACCOUNT_HAS_ACTIVE_JOB"
    erase.assert_not_awaited()


@pytest.mark.asyncio
async def test_partner_delete_commits_then_clears_files_position_and_login():
    p = _partner()
    auth_id = p.auth_user_id
    db = AsyncMock()
    redis = MagicMock(zrem=AsyncMock(), delete=AsyncMock())
    files = AsyncMock()
    login = AsyncMock(return_value=True)
    with patch.object(partner_repository, "get_partner_by_id", AsyncMock(return_value=p)), \
         patch.object(partner_repository, "count_live_work", AsyncMock(return_value=0)), \
         patch.object(partner_repository, "erase_partner_data", AsyncMock(return_value=["p/1.jpg", "p/2.pdf"])), \
         patch("app.utils.storage.delete_objects", files), \
         patch("app.services.partner_service.get_redis", return_value=redis), \
         patch.object(auth_service, "delete_login_if_unused", login):
        await partner_service.delete_me(db, _identity(p))
    db.commit.assert_awaited_once()
    files.assert_awaited_once_with(["p/1.jpg", "p/2.pdf"])
    redis.zrem.assert_awaited_once()
    assert redis.zrem.await_args.args[1] == str(p.id)
    login.assert_awaited_once_with(db, auth_id)


@pytest.mark.asyncio
async def test_a_storage_failure_does_not_undo_the_deletion():
    p = _partner()
    db = AsyncMock()
    with patch.object(partner_repository, "get_partner_by_id", AsyncMock(return_value=p)), \
         patch.object(partner_repository, "count_live_work", AsyncMock(return_value=0)), \
         patch.object(partner_repository, "erase_partner_data", AsyncMock(return_value=["p/1.jpg"])), \
         patch("app.utils.storage.delete_objects", AsyncMock(side_effect=RuntimeError("503"))), \
         patch("app.services.partner_service.get_redis", return_value=MagicMock(zrem=AsyncMock(), delete=AsyncMock())), \
         patch.object(auth_service, "delete_login_if_unused", AsyncMock()) as login:
        await partner_service.delete_me(db, _identity(p))
    db.commit.assert_awaited_once()
    login.assert_awaited_once()


@pytest.mark.asyncio
async def test_erase_partner_data_anonymises_the_row():
    p = _partner()
    db = AsyncMock()
    paths_result = MagicMock()
    paths_result.scalars.return_value.all.return_value = ["partners/x/doc.jpg"]
    db.execute = AsyncMock(return_value=paths_result)
    paths = await partner_repository.erase_partner_data(db, p)
    assert paths == ["partners/x/doc.jpg"]
    assert p.name == "Deleted partner"
    assert p.phone.startswith("del") and len(p.phone) == 15 and p.phone[3:] == p.id.hex[:12]
    assert p.auth_user_id is None and p.is_available is False
    assert p.verification_status == "suspended"
    assert p.deleted_at is not None
    # documents, equipment, services, interest, notifications, push tokens, rating text
    assert db.execute.await_count == 8
    db.flush.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_staff_cannot_change_a_deleted_partner():
    from app.api import admin as admin_api
    from app.schemas.admin import AdminPartnerVerificationRequest

    gone = _partner(deleted_at=datetime.now(timezone.utc), verification_status="suspended")
    staff = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.uuid4(), admin_role="ops")
    with patch.object(partner_repository, "get_partner_by_id", AsyncMock(return_value=gone)), \
         patch.object(partner_repository, "update_partner_verification", AsyncMock()) as upd:
        with pytest.raises(ConflictError) as exc:
            await admin_api.verify_partner(
                gone.id, AdminPartnerVerificationRequest(verification_status="pending"), staff, AsyncMock())
    assert exc.value.code == "PARTNER_ACCOUNT_DELETED"
    upd.assert_not_awaited()


# --- response headers ------------------------------------------------------------

def _client():
    async def ok(_request):
        return JSONResponse({"ok": True})
    app = Starlette(routes=[Route("/x", ok)])
    app.add_middleware(SecurityHeadersMiddleware)
    return TestClient(app)


def test_every_response_carries_the_browser_protections():
    r = _client().get("/x")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "strict-transport-security" not in r.headers  # plain HTTP: no HSTS


def test_hsts_only_behind_https():
    r = _client().get("/x", headers={"X-Forwarded-Proto": "https"})
    assert r.headers["strict-transport-security"].startswith("max-age=")
