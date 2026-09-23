"""
Unit tests for app/services/user_service.py and the identity split in
app/services/auth_service.py.

These exist because tests/integration/check_user_registration.py cannot reach
the branches they cover. Registration's phone logic keys off the token's `phone`
claim, and this Supabase project answers `phone_provider_disabled` to a phone
sign-in — the Admin API will create a phone account, but the password grant will
not issue a token for one, so a phone-claim token cannot be obtained from it at
all. The integration harness skips those assertions by name rather than passing
them silently, and points here. Here the claims are constructed directly, which
is exactly the case where a unit test is the right tool: the input is a value,
not a system.

No database. The repositories are stubbed, because what is under test is the
*decision* — which error, which phone_verified — and not the SQL, which the
integration harness already exercises against real Postgres.
"""
import asyncio
import uuid
from typing import Optional

import pytest

from app.services import auth_service, user_service
from app.services.auth_service import TokenClaims
from app.utils.errors import AppError, ErrorCode

AUTH_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER_AUTH_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


class FakeSession:
    """Just enough AsyncSession for the service's transaction boundary.

    Records whether commit or rollback was reached, which is the assertion that
    matters on the rejection paths: a refused registration must leave nothing
    behind, and "raised the right error but committed anyway" is precisely the
    bug a status-code-only test would miss.
    """

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def refresh(self, _obj) -> None:
        return None


class FakeUser:
    def __init__(self, **kwargs) -> None:
        self.id = kwargs.pop("id", uuid.uuid4())
        self.phone_verified = kwargs.get("phone_verified")
        for key, value in kwargs.items():
            setattr(self, key, value)


class Payload:
    """Stands in for UserRegisterRequest — the service only reads attributes."""

    def __init__(self, name: str = "QA Owner", phone: str = "+919000000901",
                 email: Optional[str] = None) -> None:
        self.name = name
        self.phone = phone
        self.email = email


@pytest.fixture
def stub_repos(monkeypatch):
    """Point every repository call at an in-memory answer.

    Returns the dict of knobs each test tweaks, plus `created`, which captures
    the kwargs create_user_row was called with — that capture is the only way to
    assert what phone_verified would have been *written*, as opposed to what the
    response happens to echo.
    """
    state = {
        "existing_by_phone": None,
        "existing_by_email": None,
        "linked_user": None,
        "linked_partner": None,
        "created": None,
        "raise_on_create": None,
    }

    async def get_user_by_phone(_db, _phone):
        return state["existing_by_phone"]

    async def get_user_by_email(_db, _email):
        return state["existing_by_email"]

    async def get_user_by_auth_id(_db, _auth_id):
        return state["linked_user"]

    async def get_partner_by_auth_id(_db, _auth_id):
        return state["linked_partner"]

    async def create_user_row(_db, **kwargs):
        if state["raise_on_create"] is not None:
            raise state["raise_on_create"]
        state["created"] = kwargs
        return FakeUser(**kwargs)

    monkeypatch.setattr(user_service.user_repository, "get_user_by_phone", get_user_by_phone)
    monkeypatch.setattr(user_service.user_repository, "get_user_by_email", get_user_by_email)
    monkeypatch.setattr(user_service.user_repository, "create_user_row", create_user_row)
    monkeypatch.setattr(user_service.auth_repository, "get_user_by_auth_id", get_user_by_auth_id)
    monkeypatch.setattr(user_service.auth_repository, "get_partner_by_auth_id", get_partner_by_auth_id)
    return state


def register(payload: Payload, claims: TokenClaims, session: FakeSession):
    """Run the coroutine. asyncio.run() rather than pytest-asyncio, which this
    project does not depend on — one test module is not worth a plugin."""
    return asyncio.run(user_service.register_user(session, payload, claims))


class TestPhoneVerifiedIsProvedNotClaimed:
    """The spec said phone_verified=true unconditionally. See ADR-011 for why
    that is unsafe with a UNIQUE phone column, and what replaced it."""

    def test_matching_phone_claim_stores_true(self, stub_repos):
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")
        register(Payload(phone="+919000000901"), claims, session)

        assert stub_repos["created"]["phone_verified"] is True
        assert session.committed

    def test_absent_phone_claim_stores_false_but_still_registers(self, stub_repos):
        """Email and OAuth sign-ins carry no phone claim.

        Refusing them would block a legitimate signup over a claim that was
        never required. Recording false is honest and stays correctable.
        """
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone=None, email="owner@example.invalid")
        register(Payload(phone="+919000000901"), claims, session)

        assert stub_repos["created"]["phone_verified"] is False
        assert session.committed

    def test_mismatched_phone_is_refused_and_writes_nothing(self, stub_repos):
        """The squatting case. users.phone is UNIQUE, so a row written here
        would lock the number's real owner out of the platform permanently."""
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000905")

        with pytest.raises(AppError) as exc:
            register(Payload(phone="+919000000904"), claims, session)

        assert exc.value.code == ErrorCode.PHONE_MISMATCH
        assert exc.value.status_code == 400
        assert stub_repos["created"] is None
        assert not session.committed

    def test_phone_is_stored_exactly_as_submitted(self, stub_repos):
        """Digits-only is a comparison device, not a storage format. The row
        keeps the client's E.164 spelling so the database holds one canonical
        format rather than a stripped variant the service invented."""
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")
        register(Payload(phone="+91 90000 00901"), claims, session)

        assert stub_repos["created"]["phone"] == "+91 90000 00901"
        assert stub_repos["created"]["phone_verified"] is True


class TestPhoneComparison:
    def test_separators_and_plus_are_ignored(self):
        assert user_service._digits("+91-90000 00901") == "919000000901"
        assert user_service._digits(None) == ""

    def test_suffix_does_not_count_as_a_match(self, stub_repos):
        """Why equality on digits and not endswith().

        '+1 9000000801' is a suffix of '+91 9000000801'. Suffix matching would
        let a US number register an Indian one as verified, which is the exact
        hole this check exists to close.
        """
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000801")

        with pytest.raises(AppError) as exc:
            register(Payload(phone="+19000000801"), claims, session)

        assert exc.value.code == ErrorCode.PHONE_MISMATCH


class TestRegistrationGuards:
    def test_duplicate_phone_is_a_named_error_not_a_constraint_violation(self, stub_repos):
        stub_repos["existing_by_phone"] = FakeUser(phone="+919000000901")
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")

        with pytest.raises(AppError) as exc:
            register(Payload(phone="+919000000901"), claims, session)

        assert exc.value.code == ErrorCode.USER_ALREADY_EXISTS
        assert exc.value.status_code == 400
        assert stub_repos["created"] is None

    def test_duplicate_email_is_caught_too(self, stub_repos):
        stub_repos["existing_by_email"] = FakeUser(email="taken@example.invalid")
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")

        with pytest.raises(AppError) as exc:
            register(Payload(email="taken@example.invalid"), claims, session)

        assert exc.value.code == ErrorCode.USER_ALREADY_EXISTS

    def test_email_is_not_looked_up_when_none_was_sent(self, stub_repos):
        """A null email must not collide with the other rows that have none."""
        stub_repos["existing_by_email"] = FakeUser(email=None)
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")
        register(Payload(email=None), claims, session)

        assert session.committed

    def test_account_already_owning_a_user_profile_is_refused(self, stub_repos):
        stub_repos["linked_user"] = FakeUser()
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")

        with pytest.raises(AppError) as exc:
            register(Payload(), claims, session)

        assert exc.value.code == ErrorCode.AUTH_ALREADY_LINKED
        assert exc.value.status_code == 409

    def test_account_already_owning_a_partner_profile_is_refused(self, stub_repos):
        """Without this, a mechanic grows a second owner-shaped identity on the
        same credential and resolve_identity then refuses them both roles."""
        stub_repos["linked_partner"] = FakeUser()
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")

        with pytest.raises(AppError) as exc:
            register(Payload(), claims, session)

        assert exc.value.code == ErrorCode.AUTH_ALREADY_LINKED

    def test_insert_race_rolls_back_and_reports_a_duplicate(self, stub_repos):
        from sqlalchemy.exc import IntegrityError

        stub_repos["raise_on_create"] = IntegrityError("INSERT", {}, Exception("unique"))
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")

        with pytest.raises(AppError) as exc:
            register(Payload(), claims, session)

        assert exc.value.code == ErrorCode.USER_ALREADY_EXISTS
        assert session.rolled_back
        assert not session.committed

    def test_unexpected_database_error_rolls_back_and_is_a_500(self, stub_repos):
        from sqlalchemy.exc import SQLAlchemyError

        stub_repos["raise_on_create"] = SQLAlchemyError("connection lost")
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")

        with pytest.raises(AppError) as exc:
            register(Payload(), claims, session)

        assert exc.value.status_code == 500
        assert session.rolled_back

    def test_auth_user_id_comes_from_the_token_and_is_set_in_the_insert(self, stub_repos):
        """Registration is atomic: there is no window in which an unowned
        users row exists, so no second call is needed to claim it."""
        session = FakeSession()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000901")
        register(Payload(), claims, session)

        assert stub_repos["created"]["auth_user_id"] == AUTH_ID


@pytest.fixture
def stub_unlinked(monkeypatch):
    """Control what an unlinked-profile lookup finds."""
    state = {"partner": None, "user": None, "partner_args": None, "user_args": None}

    async def get_partner_by_phone_unlinked(_db, phones):
        state["partner_args"] = list(phones)
        return state["partner"]

    async def get_user_by_phone_unlinked(_db, phones):
        state["user_args"] = list(phones)
        return state["user"]

    monkeypatch.setattr(auth_service.auth_repository, "get_partner_by_phone_unlinked",
                        get_partner_by_phone_unlinked)
    monkeypatch.setattr(auth_service.auth_repository, "get_user_by_phone_unlinked",
                        get_user_by_phone_unlinked)
    return state


class TestUnlinkedProfileLookup:
    """The evidence behind IDENTITY_NOT_LINKED vs USER_NOT_REGISTERED."""

    def test_both_spellings_of_the_number_are_tried(self, stub_unlinked):
        asyncio.run(auth_service._find_unlinked_profile(None, "919000000801"))
        assert stub_unlinked["partner_args"] == ["919000000801", "+919000000801"]

    def test_a_leading_plus_is_handled_the_same_way(self, stub_unlinked):
        asyncio.run(auth_service._find_unlinked_profile(None, "+919000000801"))
        assert stub_unlinked["partner_args"] == ["+919000000801", "919000000801"]

    def test_no_phone_claim_means_no_lookup_at_all(self, stub_unlinked):
        """Nothing to match on, and this runs on the failure path of every
        unregistered request — so it must not cost a query."""
        assert asyncio.run(auth_service._find_unlinked_profile(None, None)) is None
        assert stub_unlinked["partner_args"] is None

    def test_partner_wins_when_present(self, stub_unlinked):
        stub_unlinked["partner"] = object()
        assert asyncio.run(auth_service._find_unlinked_profile(None, "919000000801")) == "partner"

    def test_user_is_found_when_no_partner_matches(self, stub_unlinked):
        stub_unlinked["user"] = object()
        assert asyncio.run(auth_service._find_unlinked_profile(None, "919000000801")) == "user"

    def test_nothing_found_returns_none(self, stub_unlinked):
        assert asyncio.run(auth_service._find_unlinked_profile(None, "919000000801")) is None


@pytest.fixture
def stub_identity(monkeypatch):
    """Make resolve_identity find no local row, so it reaches the split."""
    async def none_by_auth_id(_db, _auth_id):
        return None

    monkeypatch.setattr(auth_service.auth_repository, "get_user_by_auth_id", none_by_auth_id)
    monkeypatch.setattr(auth_service.auth_repository, "get_partner_by_auth_id", none_by_auth_id)


class TestIdentityResolutionSplit:
    def test_unclaimed_profile_gets_identity_not_linked(self, stub_identity, stub_unlinked):
        """The case a blanket rename would have broken: a mechanic onboarded by
        ops through the open POST /partners, waiting for link-auth. Send them to
        owner signup and their next call fails with PARTNER_ALREADY_EXISTS."""
        stub_unlinked["partner"] = object()
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000801")

        with pytest.raises(AppError) as exc:
            asyncio.run(auth_service.resolve_identity(None, claims))

        assert exc.value.code == ErrorCode.IDENTITY_NOT_LINKED
        assert exc.value.status_code == 403
        assert "link-auth" in exc.value.message

    def test_no_profile_at_all_gets_user_not_registered(self, stub_identity, stub_unlinked):
        claims = TokenClaims(auth_user_id=AUTH_ID, phone="919000000801")

        with pytest.raises(AppError) as exc:
            asyncio.run(auth_service.resolve_identity(None, claims))

        assert exc.value.code == ErrorCode.USER_NOT_REGISTERED
        assert exc.value.status_code == 403
        assert "/api/v1/users" in exc.value.message

    def test_neither_is_a_401(self, stub_identity, stub_unlinked):
        """A 401 sends the client back to OTP entry. The token is already valid,
        so that loop has no exit — the user can never reach signup."""
        claims = TokenClaims(auth_user_id=OTHER_AUTH_ID, phone=None)

        with pytest.raises(AppError) as exc:
            asyncio.run(auth_service.resolve_identity(None, claims))

        assert exc.value.status_code != 401

    def test_the_two_codes_are_actually_different(self):
        """Guards against a well-meaning cleanup collapsing them to one value."""
        assert ErrorCode.USER_NOT_REGISTERED != ErrorCode.IDENTITY_NOT_LINKED
