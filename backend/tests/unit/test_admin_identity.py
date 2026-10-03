"""
Unit tests for admin identity: resolution, the role gate, and the three places
an account gets bound to a local row.

Why these are unit tests and not assertions in the live harness: two of the
three things under test here are states the database cannot be driven into
through the API. "This Supabase account is already an admin's *and* is now
claiming a partner profile" is precisely the state the guards exist to prevent,
so a harness that goes through the endpoints can only ever observe the guard
working — it cannot show what the guard is for. Here the repository answers are
values, so the pre-guard world is one line away.

The third, resolve_identity returning role="admin", *is* reachable live and
check_admin_analytics.py asserts it end to end. It is repeated here because the
ambiguity branch beside it is not reachable live, and testing one without the
other would leave the interesting half uncovered.

See ADR-020. No database: what is under test is the decision, not the SQL.
"""
import asyncio
import uuid
from typing import Optional

import pytest

from app.services import auth_service, user_service
from app.services.auth_service import Identity, TokenClaims
from app.utils import auth as auth_utils
from app.utils.errors import AppError, ErrorCode

AUTH_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
USER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
PARTNER_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
ADMIN_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")


class Row:
    """Stands in for a User, Partner or Admin — only `.id` is ever read."""

    def __init__(self, row_id: uuid.UUID) -> None:
        self.id = row_id
        self.auth_user_id = None


class FakeSession:
    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def refresh(self, _obj) -> None:
        return None

    async def flush(self) -> None:
        return None


@pytest.fixture
def lookups(monkeypatch):
    """Control what each of the three auth_user_id lookups finds."""
    state = {"user": None, "partner": None, "admin": None}

    async def get_user_by_auth_id(_db, _auth_id):
        return state["user"]

    async def get_partner_by_auth_id(_db, _auth_id):
        return state["partner"]

    async def get_admin_by_auth_id(_db, _auth_id):
        return state["admin"]

    for module in (auth_service, user_service):
        monkeypatch.setattr(module.auth_repository, "get_user_by_auth_id",
                            get_user_by_auth_id)
        monkeypatch.setattr(module.auth_repository, "get_partner_by_auth_id",
                            get_partner_by_auth_id)
        monkeypatch.setattr(module.auth_repository, "get_admin_by_auth_id",
                            get_admin_by_auth_id)
    return state


def resolve(claims: Optional[TokenClaims] = None) -> Identity:
    """asyncio.run() rather than pytest-asyncio, which this project does not
    depend on — see the note in test_user_service.py."""
    return asyncio.run(
        auth_service.resolve_identity(None, claims or TokenClaims(auth_user_id=AUTH_ID))
    )


# --------------------------------------------------------------------------
# 1. An admin resolves to an admin
# --------------------------------------------------------------------------
class TestAdminResolves:
    def test_admin_row_gives_the_admin_role(self, lookups):
        lookups["admin"] = Row(ADMIN_ID)
        identity = resolve()
        assert identity.role == "admin"

    def test_local_id_is_the_admins_row_id(self, lookups):
        """Not the Supabase sub. An admin's local_id scopes nothing today, but
        it is what an audit row would record, and recording the wrong id is the
        kind of mistake only noticed when the audit is needed."""
        lookups["admin"] = Row(ADMIN_ID)
        identity = resolve()
        assert identity.local_id == ADMIN_ID
        assert identity.auth_user_id == AUTH_ID

    def test_a_customer_is_still_a_customer(self, lookups):
        """The third lookup must not change the answer for everybody else."""
        lookups["user"] = Row(USER_ID)
        identity = resolve()
        assert (identity.role, identity.local_id) == ("user", USER_ID)

    def test_a_mechanic_is_still_a_mechanic(self, lookups):
        lookups["partner"] = Row(PARTNER_ID)
        identity = resolve()
        assert (identity.role, identity.local_id) == ("partner", PARTNER_ID)


# --------------------------------------------------------------------------
# 2. Two rows for one account is a server fault, never a choice
# --------------------------------------------------------------------------
class TestAmbiguityIsRefused:
    """The pre-existing user+partner case, plus the two the admins table adds.

    Picking one would not be a mix-up here. Preferring the admin row would hand
    admin to whoever created the second row; preferring the user row would
    demote a real admin. Both are worse than a 500, which is why this is an
    InternalError and not a resolution rule.
    """

    @pytest.mark.parametrize(
        "present",
        [
            ("user", "partner"),
            ("user", "admin"),
            ("partner", "admin"),
            ("user", "partner", "admin"),
        ],
        ids=["user+partner", "user+admin", "partner+admin", "all three"],
    )
    def test_more_than_one_match_is_an_internal_error(self, lookups, present):
        ids = {"user": USER_ID, "partner": PARTNER_ID, "admin": ADMIN_ID}
        for key in present:
            lookups[key] = Row(ids[key])

        with pytest.raises(AppError) as exc:
            resolve()
        assert exc.value.status_code == 500

    def test_exactly_one_match_is_not_an_error(self, lookups):
        """Guards the parametrize above against a rewrite that fails on one."""
        lookups["admin"] = Row(ADMIN_ID)
        assert resolve().role == "admin"


# --------------------------------------------------------------------------
# 3. require_admin
# --------------------------------------------------------------------------
def gate(role: str):
    identity = Identity(auth_user_id=AUTH_ID, role=role, local_id=ADMIN_ID)
    return asyncio.run(auth_utils.require_admin(identity))


class TestRequireAdmin:
    def test_an_admin_passes_through_unchanged(self):
        assert gate("admin").role == "admin"

    @pytest.mark.parametrize("role", ["user", "partner"])
    def test_everyone_else_is_403_not_401(self, role):
        """403, consistent with require_user and require_partner: we know
        exactly who they are, they simply may not do this. A 401 would send a
        perfectly valid session back to the OTP screen to loop."""
        with pytest.raises(AppError) as exc:
            gate(role)
        assert exc.value.status_code == 403
        assert exc.value.code == ErrorCode.FORBIDDEN

    def test_the_refusal_names_no_admin_and_no_endpoint(self):
        """The message reaches any logged-in customer who finds the URL, so it
        must not confirm who the admins are or what the route reads."""
        with pytest.raises(AppError) as exc:
            gate("user")
        message = exc.value.message.lower()
        assert "@" not in message
        assert not any(digit in message for digit in "0123456789")


# --------------------------------------------------------------------------
# 4. An admin's account cannot pick up a second profile
# --------------------------------------------------------------------------
class TestAdminAccountCannotBeBoundAgain:
    """Each table's UNIQUE index guards only that table, so nothing at the
    database level stops an admin's `sub` from also landing in users or
    partners. These three pre-checks are the whole defence, and what they
    prevent is not a duplicate row — it is the two-table state resolve_identity
    answers with a 500, which that account would then get on *every* request it
    ever made.
    """

    def test_registration_refuses_an_admins_account(self, lookups, monkeypatch):
        lookups["admin"] = Row(ADMIN_ID)

        async def never(*_args, **_kwargs):
            raise AssertionError("the insert must not be reached")

        async def no_row(*_args, **_kwargs):
            return None

        monkeypatch.setattr(user_service.user_repository, "get_user_by_phone", no_row)
        monkeypatch.setattr(user_service.user_repository, "get_user_by_email", no_row)
        monkeypatch.setattr(user_service.user_repository, "create_user_row", never)

        class Payload:
            name, phone, email = "QA Admin", "+919000000950", None

        session = FakeSession()
        with pytest.raises(AppError) as exc:
            asyncio.run(
                user_service.register_user(
                    session, Payload(), TokenClaims(auth_user_id=AUTH_ID)
                )
            )
        assert exc.value.code == ErrorCode.AUTH_ALREADY_LINKED
        assert session.committed is False

    def test_link_user_auth_refuses_an_admins_account(self, lookups, monkeypatch):
        lookups["admin"] = Row(ADMIN_ID)

        target = Row(USER_ID)

        async def get_user_by_id(_db, _user_id):
            return target

        async def never(*_args, **_kwargs):
            raise AssertionError("the link must not be reached")

        monkeypatch.setattr(auth_service.auth_repository, "get_user_by_id",
                            get_user_by_id)
        monkeypatch.setattr(auth_service.auth_repository, "set_user_auth_id", never)

        session = FakeSession()
        with pytest.raises(AppError) as exc:
            asyncio.run(
                auth_service.link_user_auth(
                    session, USER_ID, TokenClaims(auth_user_id=AUTH_ID)
                )
            )
        assert exc.value.code == ErrorCode.AUTH_ALREADY_LINKED
        assert target.auth_user_id is None
        assert session.committed is False

    def test_link_partner_auth_refuses_an_admins_account(self, lookups, monkeypatch):
        lookups["admin"] = Row(ADMIN_ID)

        target = Row(PARTNER_ID)

        async def get_partner_by_id(_db, _partner_id):
            return target

        async def never(*_args, **_kwargs):
            raise AssertionError("the link must not be reached")

        monkeypatch.setattr(auth_service.partner_repository, "get_partner_by_id",
                            get_partner_by_id)
        monkeypatch.setattr(auth_service.auth_repository, "set_partner_auth_id", never)

        session = FakeSession()
        with pytest.raises(AppError) as exc:
            asyncio.run(
                auth_service.link_partner_auth(
                    session, PARTNER_ID, TokenClaims(auth_user_id=AUTH_ID)
                )
            )
        assert exc.value.code == ErrorCode.AUTH_ALREADY_LINKED
        assert target.auth_user_id is None
        assert session.committed is False


# --------------------------------------------------------------------------
# 5. An unprovisioned admin is not told to call a link-auth endpoint
# --------------------------------------------------------------------------
class TestNoAdminLinkPath:
    def test_an_unmatched_token_never_reports_an_unlinked_admin(self, monkeypatch):
        """_find_unlinked_profile searches by phone and admins has no phone
        column, so an admin row can never surface in the IDENTITY_NOT_LINKED
        branch — whose message names two endpoints, neither of which exists for
        admins. Pinned because the obvious "be helpful and look admins up too"
        change would make the API advertise a route that is deliberately absent.
        """
        async def found(_db, _phones):
            return Row(uuid.uuid4())

        monkeypatch.setattr(auth_service.auth_repository,
                            "get_partner_by_phone_unlinked", found)
        monkeypatch.setattr(auth_service.auth_repository,
                            "get_user_by_phone_unlinked", found)

        kind = asyncio.run(
            auth_service._find_unlinked_profile(None, "919000000950")
        )
        assert kind in ("user", "partner")
        assert kind != "admin"
