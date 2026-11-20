"""G8 profile edit, G10 export and deletion (ADR-025)."""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.models.user import User
from app.schemas.user import UserMeUpdateRequest
from app.services import user_service
from app.utils.errors import BadRequestError, ConflictError, NotFoundError


def _user(**kw) -> User:
    base = dict(id=uuid.uuid4(), name="Asha", phone="+919000000001", email="a@x.in",
                created_at=datetime.now(timezone.utc))
    base.update(kw)
    return User(**base)


def test_absent_email_and_null_email_are_different():
    assert "email" not in UserMeUpdateRequest(name="A").model_fields_set
    assert "email" in UserMeUpdateRequest(email=None).model_fields_set


@pytest.mark.asyncio
async def test_email_owned_by_someone_else_is_refused():
    me, other = _user(), _user(email="taken@x.in")
    with patch("app.repositories.user_repository.get_user_by_id", AsyncMock(return_value=me)), \
         patch("app.repositories.user_repository.get_user_by_email", AsyncMock(return_value=other)):
        with pytest.raises(BadRequestError):
            await user_service.update_me(AsyncMock(), me.id, name=None, email="Taken@x.in", email_set=True)


@pytest.mark.asyncio
async def test_deleted_account_reads_as_missing():
    gone = _user(deleted_at=datetime.now(timezone.utc))
    with patch("app.repositories.user_repository.get_user_by_id", AsyncMock(return_value=gone)):
        with pytest.raises(NotFoundError):
            await user_service.get_me(AsyncMock(), gone.id)


@pytest.mark.asyncio
async def test_cannot_delete_with_a_live_request():
    me = _user()
    erase = AsyncMock()
    with patch("app.repositories.user_repository.get_user_by_id", AsyncMock(return_value=me)), \
         patch("app.repositories.user_repository.count_active_jobs", AsyncMock(return_value=1)), \
         patch("app.repositories.user_repository.erase_owner_data", erase):
        with pytest.raises(ConflictError) as exc:
            await user_service.delete_me(AsyncMock(), me.id, uuid.uuid4())
    assert exc.value.code == "ACCOUNT_HAS_ACTIVE_JOB"
    erase.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_anonymises_then_removes_the_login():
    me = _user()
    db = AsyncMock()
    seen = {}

    async def upd(_db, user, **fields):
        seen.update(fields)

    remove_login = AsyncMock(return_value=True)
    with patch("app.repositories.user_repository.get_user_by_id", AsyncMock(return_value=me)), \
         patch("app.repositories.user_repository.count_active_jobs", AsyncMock(return_value=0)), \
         patch("app.repositories.user_repository.erase_owner_data", AsyncMock()) as erase, \
         patch("app.repositories.user_repository.update_user_fields", side_effect=upd), \
         patch("app.services.auth_service.auth_user_still_used", AsyncMock(return_value=False)),          patch("app.services.auth_service.delete_supabase_user", remove_login):
        await user_service.delete_me(db, me.id, "auth-1")

    erase.assert_awaited_once()
    assert seen["name"] == "Deleted user" and seen["email"] is None and seen["auth_user_id"] is None
    assert seen["phone"].startswith("del") and len(seen["phone"]) == 15
    db.commit.assert_awaited_once()
    remove_login.assert_awaited_once_with("auth-1")
