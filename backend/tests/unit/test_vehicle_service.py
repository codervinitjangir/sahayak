"""
Unit tests for app/services/vehicle_service.py.

Split of responsibility with tests/integration/check_vehicle_registration.py,
which is the harness that matters for this feature: that one drives the real
endpoints against real Postgres and proves the rows land. This module covers the
things a live harness cannot reach cheaply or at all —

  * normalisation, which is a pure function over strings and where a table of
    inputs is worth more than any number of HTTP round trips,
  * the transaction boundary, where the assertion is "did it roll back", not
    "what status code came out" — a service that raises the right error and
    commits anyway returns an indistinguishable response and is still a bug,
  * the equality of the two 404 paths, which the anti-enumeration decision rests
    on and which is easy to break later by "improving" one message.

No database. The repository is stubbed: what is under test is the decision, not
the SQL.
"""
import asyncio
import uuid
from typing import Optional

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.services import vehicle_service
from app.services.vehicle_service import normalise_vehicle_number
from app.utils.errors import AppError, ErrorCode

USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER_USER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
VEHICLE_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")


class FakeSession:
    """Just enough AsyncSession for the service's transaction boundary."""

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False
        self.refreshed = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def refresh(self, _obj) -> None:
        self.refreshed = True


class FakeVehicle:
    def __init__(self, **kwargs) -> None:
        self.id = kwargs.pop("id", VEHICLE_ID)
        self.user_id = kwargs.pop("user_id", USER_ID)
        self.vehicle_type = kwargs.get("vehicle_type", "four_wheeler")
        for key, value in kwargs.items():
            setattr(self, key, value)


class Payload:
    """Stands in for VehicleCreateRequest — the service only reads attributes.

    Note what it does *not* have: a user_id. That is the point of the real
    schema's extra="forbid", and a stub that grew one would quietly make the
    "owner comes from the token" test unable to fail.
    """

    def __init__(
        self,
        vehicle_type: str = "four_wheeler",
        make: Optional[str] = "Maruti",
        model: Optional[str] = "Swift",
        vehicle_number: str = "KA01AB1234",
    ) -> None:
        self.vehicle_type = vehicle_type
        self.make = make
        self.model = model
        self.vehicle_number = vehicle_number


@pytest.fixture
def stub_repo(monkeypatch):
    """Point every repository call at an in-memory answer.

    `created` captures the kwargs create_vehicle_row was called with, which is
    the only way to assert what would actually have been *written* — as opposed
    to what the response happens to echo back.
    """
    state = {
        "vehicle": None,
        "listed": [],
        "created": None,
        "raise_on_create": None,
    }

    async def create_vehicle_row(_db, **kwargs):
        if state["raise_on_create"] is not None:
            raise state["raise_on_create"]
        state["created"] = kwargs
        return FakeVehicle(**kwargs)

    async def get_vehicle_by_id(_db, _vehicle_id):
        return state["vehicle"]

    async def list_vehicles_for_user(_db, _user_id):
        return state["listed"]

    monkeypatch.setattr(
        vehicle_service.vehicle_repository, "create_vehicle_row", create_vehicle_row
    )
    monkeypatch.setattr(
        vehicle_service.vehicle_repository, "get_vehicle_by_id", get_vehicle_by_id
    )
    monkeypatch.setattr(
        vehicle_service.vehicle_repository,
        "list_vehicles_for_user",
        list_vehicles_for_user,
    )
    return state


def run(coro):
    """asyncio.run() rather than pytest-asyncio, which this project does not
    depend on — consistent with tests/unit/test_user_service.py."""
    return asyncio.run(coro)


class TestNormalisation:
    """The one job: two spellings of one real plate must produce one string."""

    @pytest.mark.parametrize(
        "raw",
        [
            "KA01AB1234",
            "ka01ab1234",
            "KA 01 AB 1234",
            "ka 01 ab 1234",
            "  KA01AB1234  ",
            "KA-01-AB-1234",
            "KA–01–AB–1234",  # en-dashes, as a phone keyboard emits
            "Ka01 Ab-1234",
        ],
    )
    def test_every_spelling_of_one_plate_collapses_to_one_form(self, raw):
        assert normalise_vehicle_number(raw) == "KA01AB1234"

    def test_normalisation_is_idempotent(self):
        # Re-running it on stored data must be a no-op, or a future backfill
        # would rewrite rows it had already fixed.
        once = normalise_vehicle_number("ka 01 ab 1234")
        assert normalise_vehicle_number(once) == once

    @pytest.mark.parametrize(
        "raw",
        ["MH12AB9999", "22BH1234AA", "DL1CAB1111", "TN07X5678"],
    )
    def test_real_format_variety_is_accepted_unchanged(self, raw):
        # The deliberate absence of a format regex. These are four genuinely
        # different Indian registration shapes — state series, BH series, and
        # variants with different group lengths — and an MVP that refused any of
        # them would refuse a real vehicle standing in front of a real owner.
        assert normalise_vehicle_number(raw) == raw

    @pytest.mark.parametrize("raw", ["", "   ", "\t\n", "AB", "K-A", "---"])
    def test_empty_or_too_short_is_rejected(self, raw):
        with pytest.raises(AppError) as exc:
            normalise_vehicle_number(raw)
        assert exc.value.status_code == 400
        assert exc.value.code == ErrorCode.INVALID_VEHICLE_NUMBER

    @pytest.mark.parametrize("raw", ["KA01AB1234!", "KA01/AB/1234", "KA01.AB.1234"])
    def test_non_alphanumeric_is_rejected(self, raw):
        with pytest.raises(AppError) as exc:
            normalise_vehicle_number(raw)
        assert exc.value.code == ErrorCode.INVALID_VEHICLE_NUMBER

    def test_unicode_homoglyph_is_rejected(self):
        # "KА01AB1234" with a Cyrillic А. str.isalnum() is Unicode-aware and
        # would pass it, producing a second row that is byte-different and
        # visually identical to the first — the exact duplicate normalisation
        # exists to prevent, in the one form nobody can spot by reading the data.
        with pytest.raises(AppError) as exc:
            normalise_vehicle_number("KЀ01AB1234")
        assert exc.value.code == ErrorCode.INVALID_VEHICLE_NUMBER

    def test_too_long_for_the_column_is_rejected(self):
        # vehicles.vehicle_number is String(20). Caught here rather than by
        # Postgres, so the caller gets a coded 400 and not a 500.
        with pytest.raises(AppError) as exc:
            normalise_vehicle_number("A" * 21)
        assert exc.value.code == ErrorCode.INVALID_VEHICLE_NUMBER

    def test_length_is_measured_after_normalisation_not_before(self):
        # 24 characters as typed, 12 once the spaces go. Rejecting this would be
        # refusing a plate that fits the column comfortably.
        assert normalise_vehicle_number("K A 0 1 A B 1 2 3 4 5 6") == "KA01AB123456"


class TestRegisterVehicle:
    def test_owner_is_taken_from_the_argument_not_the_payload(self, stub_repo):
        session = FakeSession()
        run(vehicle_service.register_vehicle(session, Payload(), USER_ID))
        assert stub_repo["created"]["user_id"] == USER_ID

    def test_stored_number_is_the_normalised_one(self, stub_repo):
        session = FakeSession()
        run(
            vehicle_service.register_vehicle(
                session, Payload(vehicle_number="ka 01 ab 1234"), USER_ID
            )
        )
        assert stub_repo["created"]["vehicle_number"] == "KA01AB1234"

    def test_make_and_model_pass_through(self, stub_repo):
        session = FakeSession()
        run(vehicle_service.register_vehicle(session, Payload(), USER_ID))
        assert stub_repo["created"]["make"] == "Maruti"
        assert stub_repo["created"]["model"] == "Swift"

    def test_successful_registration_commits_and_refreshes(self, stub_repo):
        session = FakeSession()
        run(vehicle_service.register_vehicle(session, Payload(), USER_ID))
        assert session.committed is True
        assert session.rolled_back is False
        # refresh, because created_at is a server default and the unrefreshed
        # object holds a ClauseElement where the response needs a timestamp.
        assert session.refreshed is True

    def test_duplicate_number_is_not_refused(self, stub_repo):
        # The deliberate absence of a uniqueness check, asserted rather than
        # assumed: registering a number twice must produce a second row, for the
        # same owner and for anyone else. See ADR-014.
        session = FakeSession()
        run(vehicle_service.register_vehicle(session, Payload(), USER_ID))
        first = stub_repo["created"]
        second_session = FakeSession()
        run(vehicle_service.register_vehicle(second_session, Payload(), OTHER_USER_ID))
        assert first["vehicle_number"] == stub_repo["created"]["vehicle_number"]
        assert second_session.committed is True

    def test_bad_number_never_opens_a_transaction(self, stub_repo):
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            run(
                vehicle_service.register_vehicle(
                    session, Payload(vehicle_number="!!"), USER_ID
                )
            )
        assert exc.value.code == ErrorCode.INVALID_VEHICLE_NUMBER
        assert stub_repo["created"] is None
        assert session.committed is False
        # Nothing to roll back, because validation runs before the try block.
        assert session.rolled_back is False

    def test_database_failure_rolls_back_and_raises_internal(self, stub_repo):
        stub_repo["raise_on_create"] = SQLAlchemyError("connection lost")
        session = FakeSession()
        with pytest.raises(AppError) as exc:
            run(vehicle_service.register_vehicle(session, Payload(), USER_ID))
        assert exc.value.status_code == 500
        assert session.rolled_back is True
        assert session.committed is False


class TestListUserVehicles:
    def test_no_vehicles_is_an_empty_list_not_an_error(self, stub_repo):
        stub_repo["listed"] = []
        result = run(vehicle_service.list_user_vehicles(FakeSession(), USER_ID))
        assert result == []

    def test_vehicles_pass_through_in_repository_order(self, stub_repo):
        newest = FakeVehicle(id=uuid.uuid4())
        oldest = FakeVehicle(id=uuid.uuid4())
        stub_repo["listed"] = [newest, oldest]
        result = run(vehicle_service.list_user_vehicles(FakeSession(), USER_ID))
        # The service must not re-sort. Ordering is the repository's ORDER BY,
        # which is the only place that can do it correctly once this paginates.
        assert result == [newest, oldest]


class TestGetUserVehicle:
    def test_own_vehicle_is_returned(self, stub_repo):
        stub_repo["vehicle"] = FakeVehicle(user_id=USER_ID)
        result = run(
            vehicle_service.get_user_vehicle(FakeSession(), VEHICLE_ID, USER_ID)
        )
        assert result is stub_repo["vehicle"]

    def test_missing_vehicle_is_404(self, stub_repo):
        stub_repo["vehicle"] = None
        with pytest.raises(AppError) as exc:
            run(vehicle_service.get_user_vehicle(FakeSession(), VEHICLE_ID, USER_ID))
        assert exc.value.status_code == 404
        assert exc.value.code == ErrorCode.VEHICLE_NOT_FOUND

    def test_someone_elses_vehicle_is_404_not_403(self, stub_repo):
        stub_repo["vehicle"] = FakeVehicle(user_id=OTHER_USER_ID)
        with pytest.raises(AppError) as exc:
            run(vehicle_service.get_user_vehicle(FakeSession(), VEHICLE_ID, USER_ID))
        assert exc.value.status_code == 404
        assert exc.value.code == ErrorCode.VEHICLE_NOT_FOUND

    def test_the_two_404s_are_indistinguishable(self, stub_repo):
        """The anti-enumeration decision, stated as an assertion.

        If these two ever diverge — a kinder message for one, a different code
        for the other — the endpoint becomes an existence oracle and someone
        walking UUIDs can count the platform's vehicles. This test is what stops
        that happening by accident during a later wording cleanup.
        """
        stub_repo["vehicle"] = None
        with pytest.raises(AppError) as missing:
            run(vehicle_service.get_user_vehicle(FakeSession(), VEHICLE_ID, USER_ID))

        stub_repo["vehicle"] = FakeVehicle(user_id=OTHER_USER_ID)
        with pytest.raises(AppError) as not_mine:
            run(vehicle_service.get_user_vehicle(FakeSession(), VEHICLE_ID, USER_ID))

        assert missing.value.status_code == not_mine.value.status_code
        assert missing.value.code == not_mine.value.code
        assert missing.value.message == not_mine.value.message
