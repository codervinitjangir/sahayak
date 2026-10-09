"""
Unit tests for GET /api/v1/jobs — the role branch and the row mapping.

What is worth testing here is the decision, not the SQL: which question gets asked
for which role, who is refused, and what ends up in a row. The queries themselves
are ORM joins against real tables and a mocked repository cannot say whether they
execute — that is what the live section in check_job_lifecycle.py is for. The
admin-analytics work made the cost of forgetting that distinction concrete: 47
green unit tests over a monkeypatched repository while every endpoint returned 500.

The branch most worth pinning is the partner one. A partner's history is the jobs
they *accepted*, and the repository identifies those by `accepted_at IS NOT NULL`
rather than `job_assignments.status = 'accepted'` — because that column is
overwritten as a job ends. A status predicate would return an empty history for a
partner who has completed work, which is the exact population the screen exists
for. That is asserted live; here we pin that the partner branch is the one called.
"""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest

from app.services import job_service
from app.services.auth_service import Identity
from app.utils.errors import AppError, ErrorCode

USER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
PARTNER_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
ADMIN_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
JOB_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")
AUTH_ID = uuid.UUID("55555555-5555-4555-8555-555555555555")


def identity(role: str, local_id: uuid.UUID) -> Identity:
    return Identity(auth_user_id=AUTH_ID, role=role, local_id=local_id)


class Row:
    """Minimal stand-in for a jobs row."""

    def __init__(self, status="completed", **kw):
        self.id = JOB_ID
        self.status = status
        self.vehicle_id = uuid.uuid4()
        self.vehicle_number = "GJ-01-AB-1234"
        self.pickup_address_text = "SG Highway, Ahmedabad"
        self.issue_description = "battery dead"
        self.price_final = None
        self.requested_at = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
        self.completed_at = None
        self.cancelled_at = None
        self.cancellation_reason = None
        for k, v in kw.items():
            setattr(self, k, v)


class Named:
    def __init__(self, name):
        self.name = name


class ServiceRow:
    code = "battery_jumpstart"
    name = "Battery Jumpstart"


@pytest.fixture
def repo(monkeypatch):
    """Record which repository functions the service reaches for."""
    state = {"called": [], "rows": [], "total": 0}

    async def count_user(_db, _id):
        state["called"].append("count_jobs_for_user")
        return state["total"]

    async def list_user(_db, _id, *, limit, offset):
        state["called"].append(("list_jobs_for_user", limit, offset))
        return state["rows"]

    async def count_partner(_db, _id):
        state["called"].append("count_jobs_for_partner")
        return state["total"]

    async def list_partner(_db, _id, *, limit, offset):
        state["called"].append(("list_jobs_for_partner", limit, offset))
        return state["rows"]

    monkeypatch.setattr(job_service.job_repository, "count_jobs_for_user", count_user)
    monkeypatch.setattr(job_service.job_repository, "list_jobs_for_user", list_user)
    monkeypatch.setattr(job_service.job_repository, "count_jobs_for_partner", count_partner)
    monkeypatch.setattr(job_service.job_repository, "list_jobs_for_partner", list_partner)
    return state


# ------------------------------------------------------------- role branch


def test_an_owner_is_asked_for_the_jobs_they_requested(repo):
    asyncio.run(job_service.list_jobs(None, identity("user", USER_ID), limit=20, offset=0))
    assert "count_jobs_for_user" in repo["called"]
    assert ("list_jobs_for_user", 20, 0) in repo["called"]
    assert not any("partner" in str(c) for c in repo["called"])


def test_a_partner_is_asked_for_the_jobs_they_accepted(repo):
    asyncio.run(job_service.list_jobs(None, identity("partner", PARTNER_ID), limit=20, offset=0))
    assert "count_jobs_for_partner" in repo["called"]
    assert ("list_jobs_for_partner", 20, 0) in repo["called"]
    assert not any("for_user" in str(c) for c in repo["called"])


def test_an_admin_is_refused_rather_than_handed_an_empty_list(repo):
    """`[]` is literally correct and misleading — it reads as "no jobs yet" on a
    screen that will never have any."""
    with pytest.raises(AppError) as exc:
        asyncio.run(job_service.list_jobs(None, identity("admin", ADMIN_ID), limit=20, offset=0))
    assert exc.value.code == ErrorCode.FORBIDDEN
    assert repo["called"] == []


def test_pagination_is_passed_through_untouched(repo):
    asyncio.run(job_service.list_jobs(None, identity("user", USER_ID), limit=5, offset=40))
    assert ("list_jobs_for_user", 5, 40) in repo["called"]


# ------------------------------------------------------------- row mapping


def test_a_row_carries_the_service_code_a_client_can_act_on(repo):
    repo["rows"] = [(Row(), ServiceRow(), None)]
    repo["total"] = 1
    result = asyncio.run(
        job_service.list_jobs(None, identity("user", USER_ID), limit=20, offset=0)
    )
    assert result.items[0].service_code == "battery_jumpstart"
    assert result.items[0].service_name == "Battery Jumpstart"


def test_the_counterpart_name_is_included_and_the_phone_is_not(repo):
    """ADR-017: a name in your own history is within the release the assignment
    already made. A phone number is an action, and it belongs on the screen that
    performs it — GET /jobs/{id}, where the gate lives."""
    repo["rows"] = [(Row(), ServiceRow(), Named("Ramesh Kumar"))]
    repo["total"] = 1
    item = asyncio.run(
        job_service.list_jobs(None, identity("user", USER_ID), limit=20, offset=0)
    ).items[0]
    assert item.counterpart_name == "Ramesh Kumar"
    assert "counterpart_phone" not in item.model_dump()
    assert not any("phone" in field for field in item.model_dump()), item.model_dump().keys()


def test_a_job_that_never_matched_still_appears_with_no_counterpart(repo):
    """requested, matching and no_match_found have no partner. A history that
    dropped them would be a history of successes."""
    repo["rows"] = [(Row(status="no_match_found"), ServiceRow(), None)]
    repo["total"] = 1
    item = asyncio.run(
        job_service.list_jobs(None, identity("user", USER_ID), limit=20, offset=0)
    ).items[0]
    assert item.status == "no_match_found"
    assert item.counterpart_name is None


def test_the_never_written_price_estimate_is_not_in_the_payload(repo):
    """`jobs.price_estimate` is nullable and nothing in the application sets it.
    A column that is NULL on every row reads as "this job had no estimate" rather
    than "this system has no estimates"."""
    repo["rows"] = [(Row(), ServiceRow(), None)]
    repo["total"] = 1
    item = asyncio.run(
        job_service.list_jobs(None, identity("user", USER_ID), limit=20, offset=0)
    ).items[0]
    body = item.model_dump()
    assert "price_estimate" not in body
    assert "price_final" in body


# ---------------------------------------------------------------- has_more


def test_has_more_is_true_while_rows_remain(repo):
    repo["rows"] = [(Row(), ServiceRow(), None)]
    repo["total"] = 10
    result = asyncio.run(
        job_service.list_jobs(None, identity("user", USER_ID), limit=1, offset=0)
    )
    assert result.has_more is True
    assert result.total == 10


def test_has_more_is_false_on_the_last_page(repo):
    repo["rows"] = [(Row(), ServiceRow(), None)]
    repo["total"] = 5
    result = asyncio.run(
        job_service.list_jobs(None, identity("user", USER_ID), limit=1, offset=4)
    )
    assert result.has_more is False


def test_total_counts_the_whole_history_not_the_page(repo):
    repo["rows"] = [(Row(), ServiceRow(), None)]
    repo["total"] = 73
    result = asyncio.run(
        job_service.list_jobs(None, identity("user", USER_ID), limit=1, offset=0)
    )
    assert result.total == 73
    assert len(result.items) == 1
