"""
Unit tests for POST /jobs idempotency.

The emergency button is the worst possible place for a duplicate dispatch: a
flaky connection retries, and without a key the owner gets two mechanics and
the platform gets two payouts. The route accepts an Idempotency-Key header and
the service must hold three properties:

  * an ordinary retry returns the first job without touching dispatch again;
  * a request without the header is not silently deduplicated (older clients
    still create one job per call);
  * the concurrent retry — both requests pass the initial read — is resolved by
    the unique index, not surfaced as a 500.

No database: repositories are stubbed, including one that raises IntegrityError
to stand in for the losing INSERT.
"""
import asyncio
import uuid
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.repositories import job_repository, vehicle_repository
from app.services import job_service
from app.utils.errors import AppError, ErrorCode

JOB_ID = uuid.UUID("12121212-1212-1212-1212-121212121212")
EXISTING_ID = uuid.UUID("34343434-3434-3434-3434-343434343434")
USER_ID = uuid.UUID("56565656-5656-5656-5656-565656565656")
VEHICLE_ID = uuid.UUID("78787878-7878-7878-7878-787878787878")
KEY = "9f1c2f7e-4a9b-4c1d-8e2f-3a4b5c6d7e8f"


class FakeVehicle:
    id = VEHICLE_ID
    user_id = USER_ID
    vehicle_number = "KA01AB1234"


class FakeService:
    id = 1
    code = "flat_tyre"


class FakeJob:
    def __init__(self, job_id=JOB_ID):
        self.id = job_id
        self.user_id = USER_ID
        self.status = "matching"
        self.vehicle_id = VEHICLE_ID
        self.service_id = 1
        self.vehicle_number = "KA01AB1234"
        self.pickup_address_text = "MG Road"
        self.issue_description = "Flat tyre"
        self.price_estimate = Decimal("399.00")
        self.price_final = None
        self.start_code = "4821"
        self.idempotency_key = KEY
        self.requested_at = None
        self.completed_at = None


class FakePayload:
    vehicle_id = VEHICLE_ID
    service_code = "flat_tyre"
    pickup_lat = 12.9716
    pickup_lng = 77.5946
    pickup_address_text = "MG Road"
    issue_description = "Flat tyre"


class FakeSession:
    def __init__(self):
        self.committed = False
        self.rolled_back = False

    async def commit(self):
        self.committed = True

    async def rollback(self):
        self.rolled_back = True

    async def refresh(self, obj):
        return None


@pytest.fixture
def wiring(monkeypatch):
    state = {
        "existing_reads": [],
        "created_keys": [],
        "dispatch_calls": 0,
        "existing": None,
        "raise_integrity": False,
    }

    async def get_vehicle_by_id(db, vehicle_id):
        return FakeVehicle()

    async def get_service_by_code(db, code):
        return FakeService()

    async def get_job_by_idempotency_key(db, user_id, key):
        state["existing_reads"].append((user_id, key))
        return state["existing"]

    async def create_job_row(db, **kwargs):
        state["created_keys"].append(kwargs.get("idempotency_key"))
        if state["raise_integrity"]:
            raise IntegrityError("INSERT", {}, Exception("duplicate key"))
        return FakeJob()

    async def create_status_history_row(db, **kwargs):
        return None

    async def try_dispatch(db, job):
        state["dispatch_calls"] += 1

    monkeypatch.setattr(vehicle_repository, "get_vehicle_by_id", get_vehicle_by_id)
    monkeypatch.setattr(job_repository, "get_service_by_code", get_service_by_code)
    monkeypatch.setattr(
        job_repository, "get_job_by_idempotency_key", get_job_by_idempotency_key
    )
    monkeypatch.setattr(job_repository, "create_job_row", create_job_row)
    monkeypatch.setattr(
        job_repository, "create_status_history_row", create_status_history_row
    )
    monkeypatch.setattr(job_service, "_try_dispatch", try_dispatch)
    return state


def _create(session, key=KEY):
    return asyncio.run(
        job_service.create_job(session, FakePayload(), USER_ID, idempotency_key=key)
    )


def test_retry_returns_the_first_job_without_dispatching_again(wiring):
    existing = FakeJob(EXISTING_ID)
    wiring["existing"] = existing
    session = FakeSession()

    result = _create(session)

    assert result is existing
    assert wiring["created_keys"] == []
    assert wiring["dispatch_calls"] == 0
    assert session.committed is False


def test_first_attempt_stores_the_key_on_the_job(wiring):
    session = FakeSession()

    result = _create(session)

    assert isinstance(result, FakeJob)
    assert wiring["created_keys"] == [KEY]
    assert wiring["dispatch_calls"] == 1
    assert session.committed is True


def test_request_without_a_key_is_not_deduplicated(wiring):
    session = FakeSession()

    _create(session, key=None)

    assert wiring["existing_reads"] == []
    assert wiring["created_keys"] == [None]


def test_concurrent_retry_loses_the_unique_index_and_gets_the_winner(
    wiring, monkeypatch
):
    """Both requests passed the initial read; the database picks the winner.

    The loser's IntegrityError must be translated into the same successful
    response. A 500 here would tell the owner their emergency request failed
    even though a mechanic is already on the way.
    """
    winner = FakeJob(EXISTING_ID)
    wiring["raise_integrity"] = True
    session = FakeSession()

    async def two_phase(db, user_id, key):
        wiring["existing_reads"].append((user_id, key))
        return winner if len(wiring["existing_reads"]) > 1 else None

    monkeypatch.setattr(
        job_repository, "get_job_by_idempotency_key", two_phase
    )

    result = _create(session)

    assert result is winner
    assert session.rolled_back is True
    assert wiring["created_keys"] == [KEY]


def test_integrity_error_without_a_recoverable_job_is_a_500(wiring):
    """A constraint failure that is *not* the retry race is still a real 500."""
    wiring["raise_integrity"] = True
    session = FakeSession()

    with pytest.raises(AppError) as exc:
        _create(session)

    assert exc.value.code == ErrorCode.INTERNAL_ERROR
    assert session.rolled_back is True
