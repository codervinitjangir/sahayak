"""
Unit tests for GET /api/v1/partners/me/offers.

Split of responsibility with tests/integration/check_partner_offers.py: that
harness drives the real endpoint against real Postgres and is what proves the
filtering works, because the filtering is SQL and SQL is not testable against a
stub. This module covers the three things it cannot reach cheaply —

  * the shape of what comes back, in particular what is *absent* from it. The
    privacy decision (an offered partner is not told who the owner is or where
    exactly they are) lives in a Pydantic model, and a model is exactly the kind
    of thing someone extends later "to save a round trip". The test below fails
    if that happens.
  * the poll-safety contract: no commit, no rollback, no lock. This read runs on
    a timer from every idle partner app, and a lock taken here would serialise
    against the accepts it exists to produce (CLAUDE.md principle 7). A service
    that takes one still returns a correct-looking list.
  * the coupling between the list's filter and the write path's guard. They are
    two copies of the same predicate in two modules, and the failure mode if
    they drift is silent: the list shows offers the respond call will refuse, or
    hides ones it would accept.

No database. The repository is stubbed everywhere except the one test that
compiles the statement and reads it.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.repositories import dispatch_repository
from app.schemas.partner import PartnerOfferItem, PartnerOfferJob
from app.services import dispatch_service

PARTNER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
JOB_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
ASSIGNMENT_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")

NOW = datetime(2026, 9, 25, 10, 0, 0, tzinfo=timezone.utc)


class FakeRow:
    """A row as SQLAlchemy hands it back — attribute access on labels.

    Deliberately not a dict: the service reads `row.assignment_id`, and a dict
    stub would let a renamed label pass the test and fail in production.
    """

    def __init__(self, **kwargs) -> None:
        defaults = {
            "assignment_id": ASSIGNMENT_ID,
            "job_id": JOB_ID,
            "offered_at": NOW,
            "distance_at_offer_m": Decimal("1234.50"),
            "estimated_arrival_min": 7,
            "assignment_rank": 1,
            "job_status": "matching",
            "vehicle_number": "KA01AB1234",
            "pickup_address_text": "Outer Ring Rd, near Marathahalli bridge",
            "issue_description": "Flat rear tyre",
            "price_estimate": Decimal("450.00"),
            "requested_at": NOW - timedelta(minutes=2),
            "service_code": "flat_tyre",
            "service_name": "Flat tyre",
        }
        defaults.update(kwargs)
        for key, value in defaults.items():
            setattr(self, key, value)


class FakeSession:
    """An AsyncSession that records anything that would be a bug here.

    Every method on it is one this service must never call. They are present
    rather than absent so a violation fails as an assertion with a name, not as
    an AttributeError that reads like a broken test.
    """

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False
        self.executed = 0

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def execute(self, _stmt):
        self.executed += 1
        raise AssertionError("the repository should have been stubbed")


@pytest.fixture
def stub_rows(monkeypatch):
    """Serve a fixed row list and capture the partner_id the repo was asked for."""
    captured = {}

    def _install(rows):
        async def fake_get_open_offers(db, partner_id):
            captured["partner_id"] = partner_id
            return rows

        monkeypatch.setattr(
            dispatch_repository,
            "get_open_offers_for_partner",
            fake_get_open_offers,
        )
        return captured

    return _install


def test_maps_row_to_offer_item(stub_rows):
    """Every column the query selects reaches the response, under its own name."""
    stub_rows([FakeRow()])
    session = FakeSession()

    offers = asyncio.run(dispatch_service.list_open_offers(session, PARTNER_ID))

    assert len(offers) == 1
    offer = offers[0]
    assert isinstance(offer, PartnerOfferItem)
    assert offer.assignment_id == ASSIGNMENT_ID
    assert offer.job_id == JOB_ID
    assert offer.offered_at == NOW
    assert offer.distance_at_offer_m == Decimal("1234.50")
    assert offer.estimated_arrival_min == 7
    assert offer.assignment_rank == 1

    assert isinstance(offer.job, PartnerOfferJob)
    assert offer.job.status == "matching"
    assert offer.job.service_code == "flat_tyre"
    assert offer.job.service_name == "Flat tyre"
    assert offer.job.vehicle_number == "KA01AB1234"
    assert offer.job.pickup_address_text.startswith("Outer Ring Rd")
    assert offer.job.issue_description == "Flat rear tyre"
    assert offer.job.price_estimate == Decimal("450.00")


def test_partner_id_is_passed_through_untouched(stub_rows):
    """The scope of the query is the caller's own id and nothing else.

    Thin, but it is the test that would catch a `/me` handler quietly acquiring
    a partner_id from somewhere other than the token.
    """
    captured = stub_rows([])
    asyncio.run(dispatch_service.list_open_offers(FakeSession(), PARTNER_ID))
    assert captured["partner_id"] == PARTNER_ID


def test_no_offers_is_an_empty_list_not_an_error(stub_rows):
    """An idle mechanic on shift is the normal case, not a 404."""
    stub_rows([])
    offers = asyncio.run(dispatch_service.list_open_offers(FakeSession(), PARTNER_ID))
    assert offers == []


def test_repository_order_is_preserved(stub_rows):
    """Ordering is the query's job; the service must not re-sort or reverse it.

    Asserted on ids rather than timestamps so that this keeps failing if someone
    "helpfully" sorts by offered_at in Python — which would look right here and
    be wrong the moment two offers share a timestamp.
    """
    first = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
    second = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000002")
    stub_rows(
        [
            FakeRow(assignment_id=first, offered_at=NOW),
            FakeRow(assignment_id=second, offered_at=NOW - timedelta(minutes=5)),
        ]
    )

    offers = asyncio.run(dispatch_service.list_open_offers(FakeSession(), PARTNER_ID))

    assert [o.assignment_id for o in offers] == [first, second]


def test_read_takes_no_transaction_and_no_lock(stub_rows):
    """A polled read must not commit, roll back, or lock anything.

    The positive half — that no FOR UPDATE is issued — is covered by the SQL
    test below; this half catches a service that grows a commit() while
    "tidying up", which would turn every idle poll into a write transaction
    against a five-connection pool.
    """
    stub_rows([FakeRow()])
    session = FakeSession()

    asyncio.run(dispatch_service.list_open_offers(session, PARTNER_ID))

    assert session.committed is False
    assert session.rolled_back is False


def test_offer_response_exposes_no_owner_contact_or_coordinates():
    """The privacy contract, asserted against the model rather than a sample row.

    An offer is a question. A mechanic who answers "no" must not have learned
    the customer's name, phone number or exact position in the process — that
    release is job_service's decision and it is made for the *assigned* partner,
    who this one is not yet.

    Field names rather than values, because the risk is not a bad value: it is
    someone adding `owner_phone` to save the partner app a call. If a future
    field legitimately belongs here, this list is the place to argue it.
    """
    fields = set(PartnerOfferJob.model_fields) | set(PartnerOfferItem.model_fields)
    forbidden = {
        "user_id",
        "owner_id",
        "owner_name",
        "owner_phone",
        "user_phone",
        "phone",
        "pickup_latitude",
        "pickup_longitude",
        "pickup_lat",
        "pickup_lng",
        "pickup_location",
    }
    assert fields & forbidden == set()


def test_list_filter_matches_the_write_paths_guard():
    """The list and the respond call must agree on what "answerable" means.

    Two modules hold the same predicate: this one decides what a partner is
    shown, dispatch_service decides what it will accept. If they drift, the
    symptom is not an exception — it is a list full of offers that 409 on tap,
    or an offer the partner can take but never sees.
    """
    assert (
        dispatch_repository.OFFER_ANSWERABLE_JOB_STATUS
        == dispatch_service.STATUS_MATCHING
    )


def test_query_filters_on_offered_status_and_matching_job():
    """Read the SQL, because the filter is the endpoint.

    Compiling the statement is the only way to assert on a WHERE clause without
    a database. It is coarse — it checks that the clauses exist, not that the
    planner does what we hope — but the failure it guards against is coarse too:
    a dropped predicate returning every assignment a partner ever had, including
    ones already accepted or long cancelled.

    It also pins the two things this read must NOT do: lock rows, and reach the
    jobs table for anything it should not see.
    """
    captured = {}

    class CapturingSession:
        async def execute(self, stmt):
            captured["stmt"] = stmt

            class _Result:
                def all(self_inner):
                    return []

            return _Result()

    asyncio.run(
        dispatch_repository.get_open_offers_for_partner(CapturingSession(), PARTNER_ID)
    )

    sql = str(captured["stmt"].compile(compile_kwargs={"literal_binds": True}))
    normalised = " ".join(sql.split()).lower()

    assert "job_assignments.status = 'offered'" in normalised
    assert "jobs.status = 'matching'" in normalised
    assert "job_assignments.partner_id" in normalised
    # Dashed or bare hex depending on how the compiling dialect renders a UUID
    # literal; both are the same id and neither is the point of this assertion.
    assert (str(PARTNER_ID) in normalised) or (PARTNER_ID.hex in normalised)
    assert "order by job_assignments.offered_at desc" in normalised

    # A polled read that locks is the bug CLAUDE.md principle 7 exists to stop.
    assert "for update" not in normalised

    # The columns the privacy test asserts are absent from the model must also
    # be absent from the query, or the next person to widen the model gets them
    # for free without noticing.
    assert "jobs.user_id" not in normalised
    assert "pickup_location" not in normalised
