"""Unit tests for feature interest (ADR-035). Repository stubbed; what is under
test is the request contract, the per-profile lists and the transaction boundary."""
import asyncio
import uuid
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.api.feature_interest import Feature, FeatureInterestRequest
from app.services import feature_interest_service as svc
from app.services.auth_service import Identity
from app.utils.errors import AppError, ErrorCode

LOCAL_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
SQL = Path(__file__).resolve().parents[2] / "alembic" / "0012_feature_interest_partners.sql"


class FakeSession:
    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True


def _identity(role: str) -> Identity:
    ident = Identity.__new__(Identity)
    object.__setattr__(ident, "role", role)
    object.__setattr__(ident, "local_id", LOCAL_ID)
    return ident


@pytest.fixture
def repo(monkeypatch):
    calls = {"add": [], "list": []}

    async def add(db, *, side, owner_id, feature):
        calls["add"].append((side, owner_id, feature))

    async def list_for(db, *, side, owner_id):
        calls["list"].append(side)
        return [f for (s, _, f) in calls["add"] if s == side]

    monkeypatch.setattr(svc.feature_interest_repository, "add", add)
    monkeypatch.setattr(svc.feature_interest_repository, "list_for", list_for)
    return calls


def test_request_accepts_known_features_only():
    for f in svc.OWNER_FEATURES + svc.PARTNER_FEATURES:
        assert FeatureInterestRequest(feature=f).feature == f
    for bad in ("business", "fuel"):
        with pytest.raises(ValidationError):
            FeatureInterestRequest(feature=bad)
    with pytest.raises(ValidationError):
        FeatureInterestRequest(feature="scheduled", user_id=str(LOCAL_ID))  # identity never from the body


def test_lists_match_schema_and_migration():
    assert set(get_args(Feature)) == set(svc.OWNER_FEATURES + svc.PARTNER_FEATURES)
    assert not set(svc.OWNER_FEATURES) & set(svc.PARTNER_FEATURES)
    sql = SQL.read_text()
    for f in svc.OWNER_FEATURES + svc.PARTNER_FEATURES:
        assert f"'{f}'" in sql
    assert "'business', " not in sql.split("CHECK (", 2)[-1]


@pytest.mark.parametrize("role,feature", [("user", "scheduled"), ("partner", "financing")])
def test_each_side_writes_its_own_column(repo, role, feature):
    db = FakeSession()
    out = asyncio.run(svc.register(db, _identity(role), feature))
    assert out == [feature]
    assert repo["add"] == [(role, LOCAL_ID, feature)]
    assert db.committed and not db.rolled_back


@pytest.mark.parametrize("role,feature", [("user", "financing"), ("partner", "scheduled")])
def test_other_sides_feature_is_refused(repo, role, feature):
    db = FakeSession()
    with pytest.raises(AppError) as exc:
        asyncio.run(svc.register(db, _identity(role), feature))
    assert exc.value.status_code == 400
    assert exc.value.code == ErrorCode.INVALID_FEATURE
    assert repo["add"] == [] and not db.committed


def test_admin_is_refused(repo):
    with pytest.raises(AppError) as exc:
        asyncio.run(svc.list_mine(FakeSession(), _identity("admin")))
    assert exc.value.status_code == 403


def test_register_rolls_back_on_db_error(monkeypatch):
    async def add(db, **_):
        raise SQLAlchemyError("boom")

    monkeypatch.setattr(svc.feature_interest_repository, "add", add)
    db = FakeSession()
    with pytest.raises(AppError):
        asyncio.run(svc.register(db, _identity("user"), "scheduled"))
    assert db.rolled_back and not db.committed
