"""
POST /jobs/{id}/status must not reach in_progress.

The start code is a proof of presence only if POST /jobs/{id}/start is the
*sole* path from partner_en_route to in_progress. Before this test, /status
accepted {"status": "in_progress"} from the assigned partner with no code at
all, which made the code advisory: any client (the web console did exactly
this) could start work without ever being on scene.

Exercised through the route handler so the test pins what the HTTP surface
allows, not merely what one service function does.
"""
import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.api import jobs as jobs_api
from app.schemas.job import JobStatusTransitionRequest, JobStatusTransitionResponse
from app.services import job_service
from app.utils.errors import AppError, ErrorCode

JOB_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
PARTNER_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


@pytest.fixture
def calls(monkeypatch):
    recorded = []

    async def fake_transition(db, job_id, payload, partner_id):
        recorded.append(payload.status)
        return JobStatusTransitionResponse(
            id=job_id,
            status=payload.status,
            assignment_status="accepted",
            price_final=payload.price_final,
            completed_at=None,
            cancelled_at=None,
            cancellation_reason=None,
        )

    monkeypatch.setattr(job_service, "transition_job_status", fake_transition)
    return recorded


def _post_status(payload: JobStatusTransitionRequest):
    identity = SimpleNamespace(local_id=PARTNER_ID)
    return asyncio.run(
        jobs_api.transition_job_status(JOB_ID, payload, identity=identity, db=None)
    )


def test_status_route_refuses_in_progress_without_the_code(calls):
    with pytest.raises(AppError) as exc:
        _post_status(JobStatusTransitionRequest(status="in_progress"))

    assert exc.value.code == ErrorCode.INVALID_START_CODE
    assert calls == [], "the state machine must not run at all"


@pytest.mark.parametrize("status", ["partner_en_route", "cancelled"])
def test_other_transitions_still_pass_through(calls, status):
    _post_status(JobStatusTransitionRequest(status=status))
    assert calls == [status]


def test_completion_with_a_price_still_passes_through(calls):
    _post_status(JobStatusTransitionRequest(status="completed", price_final=450))
    assert calls == ["completed"]
