"""
Unit tests for the phone-claim binding on both link-auth endpoints (2026-10-07).

What this closes: until this change `link_partner_auth` checked only that the
profile was unclaimed, so an unlinked profile was protected by nothing but the
secrecy of its UUID. Any verified Supabase account that learned an id could claim
the profile behind it — untidy for a seeded owner row, a privilege grant for a
partner row, which receives dispatch offers and sees the owner's name, phone and
coordinates once assigned (ADR-017).

These are unit tests because what is under test is a decision about two values —
the token's claim and the row's column — and the interesting cases are states the
API cannot be driven into from outside. "A token with no phone claim at all" is
the one that matters most and the one a live harness cannot easily produce now
that every harness identity carries a number.

check_auth_flow.py covers the same ground end to end with real Supabase tokens;
see its scenario 2b. ADR-011 has the argument, including why a mismatch answers
404 with the same body as a missing row rather than a distinct code.
"""
import asyncio
import uuid

import pytest

from app.services import auth_service
from app.services.auth_service import TokenClaims
from app.utils.errors import AppError, ErrorCode
from app.utils.phone import digits_only, same_number

AUTH_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
OTHER_AUTH_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
PARTNER_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
USER_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")

ROW_PHONE = "+919000000801"
CLAIM_PHONE = "919000000801"      # how Supabase reports the same number
OTHER_PHONE = "+919000000802"


class Row:
    def __init__(self, row_id, phone=ROW_PHONE, auth_user_id=None):
        self.id = row_id
        self.phone = phone
        self.auth_user_id = auth_user_id


class FakeSession:
    def __init__(self):
        self.committed = False
        self.rolled_back = False

    async def commit(self):
        self.committed = True

    async def rollback(self):
        self.rolled_back = True

    async def refresh(self, _obj):
        return None

    async def flush(self):
        return None


@pytest.fixture
def partner_link(monkeypatch):
    """Wire link_partner_auth against a controllable row, and report whether the
    write was reached."""
    state = {"row": Row(PARTNER_ID), "written": False}

    async def get_partner_by_id(_db, _pid):
        return state["row"]

    async def set_partner_auth_id(_db, row, auth_id):
        state["written"] = True
        row.auth_user_id = auth_id

    async def no_row(*_a, **_k):
        return None

    monkeypatch.setattr(auth_service.partner_repository, "get_partner_by_id", get_partner_by_id)
    monkeypatch.setattr(auth_service.auth_repository, "set_partner_auth_id", set_partner_auth_id)
    monkeypatch.setattr(auth_service.auth_repository, "get_partner_by_auth_id", no_row)
    monkeypatch.setattr(auth_service.auth_repository, "get_user_by_auth_id", no_row)
    monkeypatch.setattr(auth_service.auth_repository, "get_admin_by_auth_id", no_row)
    return state


@pytest.fixture
def user_link(monkeypatch):
    state = {"row": Row(USER_ID), "written": False}

    async def get_user_by_id(_db, _uid):
        return state["row"]

    async def set_user_auth_id(_db, row, auth_id):
        state["written"] = True
        row.auth_user_id = auth_id

    async def no_row(*_a, **_k):
        return None

    monkeypatch.setattr(auth_service.auth_repository, "get_user_by_id", get_user_by_id)
    monkeypatch.setattr(auth_service.auth_repository, "set_user_auth_id", set_user_auth_id)
    monkeypatch.setattr(auth_service.auth_repository, "get_partner_by_auth_id", no_row)
    monkeypatch.setattr(auth_service.auth_repository, "get_user_by_auth_id", no_row)
    monkeypatch.setattr(auth_service.auth_repository, "get_admin_by_auth_id", no_row)
    return state


# ------------------------------------------------- the comparison itself


def test_claim_and_column_spellings_of_one_number_match():
    """Supabase omits the leading '+', the schema stores it. Measured live:
    '919000000809' for '+919000000809'."""
    assert same_number(CLAIM_PHONE, ROW_PHONE) is True
    assert same_number(ROW_PHONE, ROW_PHONE) is True
    assert digits_only(ROW_PHONE) == CLAIM_PHONE


def test_different_numbers_do_not_match():
    assert same_number(CLAIM_PHONE, OTHER_PHONE) is False


def test_a_suffix_is_not_a_match():
    """Suffix matching collides across country codes: +1 9000000801 is a suffix
    of +91 9000000801, and this comparison decides who may claim a profile."""
    assert same_number("19000000801", "+919000000801") is False


def test_a_missing_claim_matches_nothing_including_a_missing_column():
    # An email or OAuth sign-in carries no phone claim, so it has proved no
    # number. Treating absent-as-absent as a match would hand every such token a
    # link to any row with a null phone.
    assert same_number(None, ROW_PHONE) is False
    assert same_number("", ROW_PHONE) is False
    assert same_number(None, None) is False
    assert same_number(CLAIM_PHONE, None) is False


# --------------------------------------------------------- partner link


def test_matching_claim_links_the_partner(partner_link):
    result = asyncio.run(
        auth_service.link_partner_auth(
            FakeSession(), PARTNER_ID, TokenClaims(auth_user_id=AUTH_ID, phone=CLAIM_PHONE)
        )
    )
    assert partner_link["written"] is True
    assert result.auth_user_id == AUTH_ID


def test_mismatched_claim_is_refused_as_not_found(partner_link):
    """404 with the same body a missing row produces — not 403, and not
    PHONE_MISMATCH. A distinct code would answer "that id exists, wrong number"
    and make UUID guessing an enumeration oracle for the rows this protects."""
    with pytest.raises(AppError) as exc:
        asyncio.run(
            auth_service.link_partner_auth(
                FakeSession(), PARTNER_ID, TokenClaims(auth_user_id=AUTH_ID, phone="919000000899")
            )
        )
    assert exc.value.code == ErrorCode.PARTNER_NOT_FOUND
    assert partner_link["written"] is False
    assert partner_link["row"].auth_user_id is None


def test_a_token_with_no_phone_claim_cannot_link_anything(partner_link):
    """The hole, stated as a test. Before this change any verified account could
    claim any unlinked profile whose id it learned, and an email sign-in — which
    this Supabase project can issue — carries no number at all."""
    with pytest.raises(AppError) as exc:
        asyncio.run(
            auth_service.link_partner_auth(
                FakeSession(), PARTNER_ID, TokenClaims(auth_user_id=AUTH_ID)
            )
        )
    assert exc.value.code == ErrorCode.PARTNER_NOT_FOUND
    assert partner_link["written"] is False


def test_relinking_the_same_account_still_succeeds_without_a_write(partner_link):
    """Checked before the comparison, so a client retrying after a dropped
    response gets its 200 even if the row's number was edited since."""
    partner_link["row"] = Row(PARTNER_ID, phone=OTHER_PHONE, auth_user_id=AUTH_ID)
    result = asyncio.run(
        auth_service.link_partner_auth(
            FakeSession(), PARTNER_ID, TokenClaims(auth_user_id=AUTH_ID, phone=CLAIM_PHONE)
        )
    )
    assert result.auth_user_id == AUTH_ID
    assert partner_link["written"] is False


def test_same_number_different_account_is_a_conflict_not_a_404(partner_link):
    """A real case: a mechanic who lost their phone and re-verified the same
    number on a new Supabase account. 409, because the remedy is a person
    unlinking the old account, and a 404 would hide a situation that needs one."""
    partner_link["row"] = Row(PARTNER_ID, auth_user_id=OTHER_AUTH_ID)
    with pytest.raises(AppError) as exc:
        asyncio.run(
            auth_service.link_partner_auth(
                FakeSession(), PARTNER_ID, TokenClaims(auth_user_id=AUTH_ID, phone=CLAIM_PHONE)
            )
        )
    assert exc.value.code == ErrorCode.AUTH_ALREADY_LINKED
    assert partner_link["written"] is False


def test_a_linked_profile_whose_number_differs_reveals_nothing(partner_link):
    """Mismatch is checked before the already-linked branch, so a stranger
    probing ids cannot tell a claimed profile from one that does not exist."""
    partner_link["row"] = Row(PARTNER_ID, auth_user_id=OTHER_AUTH_ID)
    with pytest.raises(AppError) as exc:
        asyncio.run(
            auth_service.link_partner_auth(
                FakeSession(), PARTNER_ID, TokenClaims(auth_user_id=AUTH_ID, phone="919000000899")
            )
        )
    assert exc.value.code == ErrorCode.PARTNER_NOT_FOUND


# ------------------------------------------------------------ user link


def test_matching_claim_links_the_user(user_link):
    result = asyncio.run(
        auth_service.link_user_auth(
            FakeSession(), USER_ID, TokenClaims(auth_user_id=AUTH_ID, phone=CLAIM_PHONE)
        )
    )
    assert user_link["written"] is True
    assert result.auth_user_id == AUTH_ID


def test_mismatched_claim_is_refused_on_the_user_route_too(user_link):
    with pytest.raises(AppError) as exc:
        asyncio.run(
            auth_service.link_user_auth(
                FakeSession(), USER_ID, TokenClaims(auth_user_id=AUTH_ID, phone="919000000899")
            )
        )
    assert exc.value.code == ErrorCode.USER_NOT_FOUND
    assert user_link["written"] is False


def test_no_claim_cannot_link_a_user(user_link):
    with pytest.raises(AppError) as exc:
        asyncio.run(
            auth_service.link_user_auth(
                FakeSession(), USER_ID, TokenClaims(auth_user_id=AUTH_ID)
            )
        )
    assert exc.value.code == ErrorCode.USER_NOT_FOUND
    assert user_link["written"] is False


def test_both_endpoints_agree_on_what_counts_as_the_same_number(partner_link, user_link):
    """One comparison, two call sites. Two private copies would stay consistent
    right up until one of them was changed."""
    partner_link["row"] = Row(PARTNER_ID, phone="+91 90000 00801")
    user_link["row"] = Row(USER_ID, phone="+91-90000-00801")
    claims = TokenClaims(auth_user_id=AUTH_ID, phone=CLAIM_PHONE)

    asyncio.run(auth_service.link_partner_auth(FakeSession(), PARTNER_ID, claims))
    asyncio.run(auth_service.link_user_auth(FakeSession(), USER_ID, claims))
    assert partner_link["written"] and user_link["written"]
