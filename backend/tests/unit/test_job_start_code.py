"""
Unit tests for the owner's 4-digit start code.

The code is a proof of presence: the owner reads it aloud, the assigned partner
submits it to POST /jobs/{id}/start, and only then does the job reach
in_progress. That makes two things worth pinning here, neither of which the
integration harness can prove cheaply:

  * the code is generated server-side, four digits, and not something a client
    could have supplied at creation;
  * a wrong code is refused *before* any transition runs, because a check that
    raises after the state machine has already moved the job is not a check.

No database. The repositories and the transition function are stubbed; the SQL
and the real state machine are covered by the harness and by
test_job_lifecycle.py respectively.
"""
import asyncio
import re
import uuid
from datetime import datetime, timezone

import pytest

from app.repositories import job_repository
from app.services import job_service
from app.schemas.job import JobStatusTransitionResponse
from app.utils.errors import AppError, ErrorCode

JOB_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
PARTNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
OTHER_PARTNER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
NOW = datetime(2026, 11, 12, 10, 0, 0, tzinfo=timezone.utc)


class FakeJob:
    def __init__(self, status: str = "partner_en_route", start_code: str | None = "4821"):
        self.id = JOB_ID
        self.status = status
        self.start_code = start_code


class FakeAssignment:
    def __init__(self, partner_id: uuid.UUID = PARTNER_ID):
        self.id = uuid.uuid4()
        self.job_id = JOB_ID
        self.partner_id = partner_id
        self.status = "accepted"


def _transition_response() -> JobStatusTransitionResponse:
    return JobStatusTransitionResponse(
        id=JOB_ID,
        status="in_progress",
        assignment_status="accepted",
        price_final=None,
        completed_at=None,
        cancelled_at=None,
        cancellation_reason=None,
    )


@pytest.fixture
def wiring(monkeypatch):
    """Stub the two reads start_job makes and capture the transition call."""
    state = {
        "job": FakeJob(),
        "assignment": FakeAssignment(),
        "transition_calls": [],
    }

    async def get_job_by_id(db, job_id):
        return state["job"]

    async def get_responsible_assignment(db, job_id):
        return state["assignment"]

    async def transition_job_status(db, job_id, payload, partner_id):
        state["transition_calls"].append(
            {"job_id": job_id, "status": payload.status, "partner_id": partner_id}
        )
        return _transition_response()

    monkeypatch.setattr(job_repository, "get_job_by_id", get_job_by_id)
    monkeypatch.setattr(
        job_repository, "get_responsible_assignment", get_responsible_assignment
    )
    monkeypatch.setattr(job_service, "transition_job_status", transition_job_status)
    return state


def _start(code: str, partner_id: uuid.UUID = PARTNER_ID):
    return asyncio.run(job_service.start_job(None, JOB_ID, code, partner_id))


class TestCodeGeneration:
    def test_generated_code_is_always_four_digits(self):
        """Four digits, no leading zero.

        1000–9999 rather than 0000–9999 because a UI that strips leading zeros
        turns "0421" into three digits, and the owner reads this aloud.
        """
        for _ in range(500):
            code = job_service._generate_start_code()
            assert re.fullmatch(r"\d{4}", code), code
            assert 1000 <= int(code) <= 9999, code

    def test_codes_are_not_a_constant(self):
        """A predictable code is a code the next customer can guess."""
        codes = {job_service._generate_start_code() for _ in range(200)}
        assert len(codes) > 1


class TestStartJob:
    def test_correct_code_moves_the_job_to_in_progress(self, wiring):
        result = _start("4821")

        assert result.status == "in_progress"
        assert wiring["transition_calls"] == [
            {"job_id": JOB_ID, "status": "in_progress", "partner_id": PARTNER_ID}
        ]

    def test_wrong_code_is_rejected_before_any_transition(self, wiring):
        """The important half is the second assertion.

        An INVALID_START_CODE response is worthless if the state machine ran
        first and the error was merely how the response was rendered.
        """
        with pytest.raises(AppError) as exc:
            _start("0000")

        assert exc.value.code == ErrorCode.INVALID_START_CODE
        assert wiring["transition_calls"] == []

    def test_legacy_job_without_a_code_cannot_be_started(self, wiring):
        """Rows predating migration 008 have no code.

        They must fail closed. Treating "no expected code" as "any code is
        fine" would silently disable the proof for exactly the jobs nobody has
        looked at since the migration.
        """
        wiring["job"] = FakeJob(start_code=None)

        with pytest.raises(AppError) as exc:
            _start("4821")

        assert exc.value.code == ErrorCode.INVALID_START_CODE
        assert wiring["transition_calls"] == []

    def test_another_partner_cannot_start_someone_elses_job(self, wiring):
        """Knowing the code is not enough; you must be the assigned partner."""
        with pytest.raises(AppError) as exc:
            _start("4821", partner_id=OTHER_PARTNER_ID)

        assert exc.value.code == ErrorCode.FORBIDDEN
        assert wiring["transition_calls"] == []

    def test_job_without_an_accepted_assignment_is_refused(self, wiring):
        wiring["assignment"] = None

        with pytest.raises(AppError) as exc:
            _start("4821")

        assert exc.value.code == ErrorCode.FORBIDDEN
        assert wiring["transition_calls"] == []

    def test_unknown_job_is_a_404_not_a_500(self, wiring):
        wiring["job"] = None

        with pytest.raises(AppError) as exc:
            _start("4821")

        assert exc.value.code == ErrorCode.JOB_NOT_FOUND
        assert wiring["transition_calls"] == []
