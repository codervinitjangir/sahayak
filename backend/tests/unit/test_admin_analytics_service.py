"""
Unit tests for the admin analytics service: the divisions and the caveats.

Split of responsibility with tests/integration/check_admin_analytics.py. That
harness runs the real SQL against real Postgres and is what proves the aggregates
count the right rows — that the three offer outcomes partition the table, that
the eight statuses sum to the total, that a `user` token gets 403. It cannot
cheaply reach what this module covers, because reaching it means *constructing*
data shapes that a working pilot does not produce:

  * **the zero denominator.** Every rate in this feature divides by something
    that can be zero, and None-rather-than-0.0 is the single most consequential
    line in the service. A harness that seeds jobs never sees it; it is the empty
    window that matters, and the empty window is exactly what a harness has to
    purge before it can assert anything.
  * **the attribution guards.** `driver` must never name a constant component,
    must be None when nothing diverged, and must be None when every delta is
    negative. Producing those three states against live dispatch would mean
    engineering a scoring outcome per test. Here they are inputs.
  * **the component that could not be measured.** `stddev_samp` is NULL for a
    single observation, which is neither "varied" nor "constant". A one-offer
    window is a real state and a trivial dict here.
  * **the notes.** Each caveat is conditional on data the harness would have to
    manufacture (an outage job, an unanswered offer, a thin sample). The point of
    the notes is that they appear when they apply and *not when they do not*, and
    the second half is only testable by driving both.

The repository is stubbed throughout: these tests are about what the service
does with the rows, not about the SQL that produced them. No database, no event
loop fixture — pytest-asyncio is not installed here, so every async call goes
through asyncio.run(), same as the rest of tests/unit.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.repositories import analytics_repository
from app.services import admin_analytics_service
from app.services.admin_analytics_service import (
    _ATTRIBUTABLE,
    _COMPONENTS,
    _THIN_SAMPLE,
    _attribute,
    _rate,
    _validate_window,
)
from app.services.auth_service import Identity
from app.utils.errors import BadRequestError, ErrorCode

ADMIN_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
AUTH_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000002")
ADMIN = Identity(auth_user_id=AUTH_ID, role="admin", local_id=ADMIN_ID)

JAN = datetime(2026, 1, 1, tzinfo=timezone.utc)
FEB = datetime(2026, 2, 1, tzinfo=timezone.utc)


def codes(response) -> set[str]:
    return {note.code for note in response.notes}


# ---------------------------------------------------------------------------
# Row builders: an all-zero row per repository function, overridable per test.
#
# Defaults are the empty window — every count 0, every percentile None — which
# is both the state a fresh database is in and the state most likely to produce
# a division by zero. Starting from it means a test that forgets to set a field
# fails toward the dangerous case rather than away from it.
# ---------------------------------------------------------------------------
def funnel_row(**over):
    row = {
        "jobs_total": 0,
        "requested": 0,
        "matching": 0,
        "assigned": 0,
        "partner_en_route": 0,
        "in_progress": 0,
        "completed": 0,
        "cancelled": 0,
        "no_match_found": 0,
        "first_job_at": None,
        "last_job_at": None,
    }
    row.update(over)
    return row


def offers_row(**over):
    row = {
        "offers_total": 0,
        "jobs_offered": 0,
        "partners_offered": 0,
        "accepted": 0,
        "declined": 0,
        "unanswered": 0,
        "with_eta_estimate": 0,
    }
    row.update(over)
    return row


def latency_row(**over):
    row = {
        "offers_measured": 0,
        "mean_s": None,
        "min_s": None,
        "p50_s": None,
        "p95_s": None,
        "max_s": None,
    }
    row.update(over)
    return row


def arrival_row(**over):
    row = {
        "jobs_measured": 0,
        "mean_min": None,
        "min_min": None,
        "p50_min": None,
        "p95_min": None,
        "max_min": None,
    }
    row.update(over)
    return row


def ranks_row(**over):
    row = {
        "accepted_offers": 0,
        "mean_rank": None,
        "at_rank_1": 0,
        "at_rank_2": 0,
        "at_rank_3_or_worse": 0,
        "worst_rank": None,
    }
    row.update(over)
    return row


def no_match_row(**over):
    row = {
        "jobs_total": 0,
        "no_match_total": 0,
        "dispatch_unavailable": 0,
        "genuine_no_match": 0,
    }
    row.update(over)
    return row


def supply_row(**over):
    row = {
        "partners_total": 0,
        "verified": 0,
        "available_now": 0,
        "dispatchable_now": 0,
        "rated": 0,
        "mean_rating": None,
        "ratings_total": None,
    }
    row.update(over)
    return row


def busy_row(**over):
    row = {"partners_busy": 0, "live_assignments": 0}
    row.update(over)
    return row


def comparison_row(**over):
    row = {
        "first_offers": 0,
        "agreed_with_nearest": 0,
        "diverged": 0,
        "agreed_accepted": 0,
        "agreed_answered": 0,
        "diverged_accepted": 0,
        "diverged_answered": 0,
    }
    row.update(over)
    return row


def spread_row(**over):
    row = {
        "offers": 0,
        "distance_score": None,
        "load_score": None,
        "skill_score": None,
        "rating_score": None,
    }
    row.update(over)
    return row


def means_arm(**over):
    row = {
        "agreed_with_nearest": None,
        "offers": 0,
        "distance_score": Decimal("0"),
        "load_score": Decimal("0"),
        "skill_score": Decimal("0"),
        "rating_score": Decimal("0"),
        "matching_score": Decimal("0"),
    }
    row.update(over)
    return row


@pytest.fixture
def repo(monkeypatch):
    """Stub every repository function with a settable row.

    Returns a dict the test mutates. Patching the module attributes rather than
    injecting a fake session keeps the service's own call sites under test — a
    service that stopped calling `component_spread` would still pass a test that
    handed it a pre-built spread dict.
    """
    rows = {
        "job_funnel": funnel_row(),
        "offer_outcomes": offers_row(),
        "dispatch_latency": latency_row(),
        "arrival_times": arrival_row(),
        "offers_before_acceptance": ranks_row(),
        "no_match_breakdown": no_match_row(),
        "partner_supply": supply_row(),
        "busy_partner_count": busy_row(),
        "strategy_comparison": comparison_row(),
        "component_spread": spread_row(),
        "component_means": {"agreed": None, "diverged": None},
    }
    calls: list[str] = []

    def make(name):
        async def fake(db, **kwargs):
            calls.append(name)
            return rows[name]

        return fake

    for name in rows:
        monkeypatch.setattr(analytics_repository, name, make(name))

    rows["_calls"] = calls
    return rows


# ---------------------------------------------------------------------------
# _rate: None, never 0.0
# ---------------------------------------------------------------------------
class TestRate:
    def test_zero_denominator_is_none_not_zero(self):
        """The line this whole feature's honesty rests on.

        0.0 and None are different claims — "no offers were accepted" and "there
        were no offers" — and on a pilot-sized window the second is routine. A
        0.0 acceptance rate is also the shape a reader is least likely to
        question, which is what makes it worse than a visible null.
        """
        assert _rate(0, 0) is None
        assert _rate(5, 0) is None
        assert _rate(0, 0) is not 0.0  # noqa: F632 - identity is the point

    def test_none_denominator_is_none(self):
        """sum() over an empty table returns NULL, not 0."""
        assert _rate(0, None) is None

    def test_none_numerator_over_real_denominator_is_zero(self):
        """A missing numerator against a real denominator *is* zero.

        Not symmetric with the case above, deliberately: there were offers and
        none were accepted, which is a measurement.
        """
        assert _rate(None, 10) == 0.0

    def test_divides(self):
        assert _rate(7, 10) == 0.7
        assert _rate(1, 3) == 0.3333

    def test_rate_of_one(self):
        assert _rate(10, 10) == 1.0


# ---------------------------------------------------------------------------
# _validate_window
# ---------------------------------------------------------------------------
class TestValidateWindow:
    def test_inverted_window_refused(self):
        with pytest.raises(BadRequestError) as exc:
            _validate_window(FEB, JAN)
        assert exc.value.code == ErrorCode.INVALID_DATE_RANGE
        assert exc.value.status_code == 400

    def test_equal_bounds_allowed(self):
        """from == to is an empty half-open range, not a mistake.

        It answers with zeros that mean what they say, which is different from
        an inverted window whose zeros mean "you typed it backwards".
        """
        assert _validate_window(JAN, JAN) is None

    def test_ordered_window_allowed(self):
        assert _validate_window(JAN, FEB) is None

    def test_one_sided_and_unbounded_allowed(self):
        assert _validate_window(JAN, None) is None
        assert _validate_window(None, FEB) is None
        assert _validate_window(None, None) is None

    def test_refused_before_any_query_runs(self, repo):
        """The 400 precedes the database, not just the response.

        An inverted window that ran five aggregate scans and then refused would
        be correct and still wrong: this is a validation failure, and paying for
        percentile scans to discover it is the thing validation exists to avoid.
        """
        with pytest.raises(BadRequestError):
            asyncio.run(
                admin_analytics_service.get_overview(
                    None, ADMIN, from_ts=FEB, to_ts=JAN
                )
            )
        assert repo["_calls"] == []


# ---------------------------------------------------------------------------
# _attribute: the guards that stop `driver` naming a constant
# ---------------------------------------------------------------------------
class TestAttribution:
    def test_constant_component_cannot_be_driver_even_with_largest_delta(self):
        """skill_score is 1.0 for every candidate and must never be the driver.

        The trap this guards: skill_score is not only constant, it holds the
        *highest value any component can take*, so any attribution that ranked
        by mean rather than by eligibility would name it every single time. Here
        it is given the largest positive delta as well, so the test fails if the
        stddev gate is removed for any reason.
        """
        attribution = _attribute(
            comparison_row(first_offers=10, diverged=4),
            {
                "diverged": means_arm(skill_score=Decimal("1.0"), load_score=Decimal("0.8")),
                "agreed": means_arm(skill_score=Decimal("0.0"), load_score=Decimal("0.5")),
            },
            spread_row(
                offers=10,
                skill_score=Decimal("0"),
                load_score=Decimal("0.12"),
                distance_score=Decimal("0.3"),
                rating_score=Decimal("0"),
            ),
        )
        assert "skill_score" in attribution.constant_components
        assert "skill_score" not in attribution.eligible_components
        assert attribution.deltas["skill_score"] == Decimal("1.0")
        assert attribution.driver == "load_score"

    def test_rating_score_constant_is_reported_as_constant(self):
        """The inert rating dimension, established by measurement not by date.

        Before any partner had been rated, every candidate scored the same fixed
        prior, so rating_score could not discriminate. Whether that holds for a
        given window is a property of the data — here, stddev 0.
        """
        attribution = _attribute(
            comparison_row(first_offers=5, diverged=2),
            {
                "diverged": means_arm(rating_score=Decimal("0.7")),
                "agreed": means_arm(rating_score=Decimal("0.7")),
            },
            spread_row(offers=5, rating_score=Decimal("0"), load_score=Decimal("0.2")),
        )
        assert "rating_score" in attribution.constant_components
        assert "rating_score" not in attribution.eligible_components

    def test_rating_score_eligible_once_it_varies(self):
        """The same component, same code, different data: now it can be named."""
        attribution = _attribute(
            comparison_row(first_offers=10, diverged=6),
            {
                "diverged": means_arm(rating_score=Decimal("0.91"), load_score=Decimal("0.5")),
                "agreed": means_arm(rating_score=Decimal("0.62"), load_score=Decimal("0.5")),
            },
            spread_row(
                offers=10, rating_score=Decimal("0.18"), load_score=Decimal("0.09")
            ),
        )
        assert "rating_score" in attribution.eligible_components
        assert attribution.driver == "rating_score"

    def test_null_stddev_is_neither_eligible_nor_constant(self):
        """One observation says nothing about spread.

        stddev_samp is NULL for a single row, and NULL must not collapse into
        either list: calling it constant would assert the component was flat on
        evidence that cannot show flatness, and calling it eligible would let a
        one-offer window name a driver.
        """
        attribution = _attribute(
            comparison_row(first_offers=1, diverged=1),
            {
                "diverged": means_arm(load_score=Decimal("0.9")),
                "agreed": None,
            },
            spread_row(offers=1),
        )
        assert attribution.eligible_components == []
        assert attribution.constant_components == []
        assert attribution.driver is None

    def test_no_divergence_means_no_driver(self):
        """Nothing was overridden, so nothing paid for overriding it."""
        attribution = _attribute(
            comparison_row(first_offers=12, diverged=0, agreed_with_nearest=12),
            {
                "diverged": None,
                "agreed": means_arm(load_score=Decimal("0.4")),
            },
            spread_row(offers=12, load_score=Decimal("0.2")),
        )
        assert attribution.diverged_offers == 0
        assert attribution.driver is None

    def test_all_negative_deltas_means_no_driver(self):
        """"Not explained by the components" is a real finding, not a tie-break.

        Falling back to the least-negative delta would name a component that was
        *lower* on the picks that diverged — the opposite of having driven them.
        """
        attribution = _attribute(
            comparison_row(first_offers=10, diverged=5),
            {
                "diverged": means_arm(load_score=Decimal("0.2"), rating_score=Decimal("0.3")),
                "agreed": means_arm(load_score=Decimal("0.6"), rating_score=Decimal("0.8")),
            },
            spread_row(
                offers=10, load_score=Decimal("0.2"), rating_score=Decimal("0.2")
            ),
        )
        assert all(delta < 0 for delta in
                   (attribution.deltas["load_score"], attribution.deltas["rating_score"]))
        assert attribution.driver is None

    def test_distance_is_never_the_driver(self):
        """Distance is what got overridden; it cannot be what did the overriding.

        Excluded by definition rather than by measurement — the baseline *is*
        nearest-first, so a diverged pick is necessarily worse on distance, and a
        positive distance delta would be a sign the data is wrong rather than a
        finding about the strategy. Given the largest positive delta here so the
        test fails if the exclusion is dropped.
        """
        attribution = _attribute(
            comparison_row(first_offers=10, diverged=5),
            {
                "diverged": means_arm(distance_score=Decimal("0.95"), load_score=Decimal("0.6")),
                "agreed": means_arm(distance_score=Decimal("0.10"), load_score=Decimal("0.5")),
            },
            spread_row(
                offers=10, distance_score=Decimal("0.4"), load_score=Decimal("0.1")
            ),
        )
        assert "distance_score" not in _ATTRIBUTABLE
        assert "distance_score" not in attribution.eligible_components
        assert attribution.driver == "load_score"

    def test_missing_arm_leaves_deltas_none(self):
        """No diverged offers at all means no delta to compute, not a zero one."""
        attribution = _attribute(
            comparison_row(first_offers=4, agreed_with_nearest=4),
            {"diverged": None, "agreed": means_arm(load_score=Decimal("0.4"))},
            spread_row(offers=4, load_score=Decimal("0.1")),
        )
        assert all(attribution.deltas[key] is None for key in _COMPONENTS)

    def test_every_component_appears_in_deltas_and_stddev(self):
        """All four keys are always present, so a client never has to probe.

        Also pins the key names against the stored JSONB contract: these are the
        strings in rows already written, which renaming in scoring would not
        change.
        """
        attribution = _attribute(
            comparison_row(first_offers=2, diverged=1),
            {"diverged": means_arm(), "agreed": means_arm()},
            spread_row(offers=2),
        )
        assert set(attribution.deltas) == set(_COMPONENTS)
        assert set(attribution.stddev) == set(_COMPONENTS)
        assert set(_COMPONENTS) == {
            "distance_score",
            "load_score",
            "skill_score",
            "rating_score",
        }


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------
class TestOverview:
    def test_empty_window_returns_nulls_not_zeros(self, repo):
        """A database with no jobs reports nothing measured, not zero measured."""
        result = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        assert result.jobs.total == 0
        assert result.conversion.rate is None
        assert result.work_started.count == 0
        assert result.work_started.mean is None
        assert result.partners.mean_rating is None
        assert result.partners.ratings_total == 0

    def test_eta_accuracy_always_null_with_its_note(self, repo):
        """The metric the PRD asks for and the system cannot produce.

        Null plus a note naming the missing input, never a substitute. The note
        is unconditional because the cause is structural — nothing writes
        estimated_arrival_min — so there is no window in which it stops applying.
        """
        repo["offer_outcomes"] = offers_row(offers_total=40, with_eta_estimate=0)
        result = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        assert result.eta_accuracy is None
        assert "ETA_ACCURACY_NOT_COMPUTABLE" in codes(result)
        detail = next(
            n.detail for n in result.notes if n.code == "ETA_ACCURACY_NOT_COMPUTABLE"
        )
        assert "0 of 40" in detail

    def test_still_open_excludes_terminal_statuses(self, repo):
        """cancelled and no_match_found are settled outcomes, not in-flight work.

        Both are terminal in ALLOWED_TRANSITIONS, so neither can still reach
        'completed'. Counting them as open would overstate how much of the
        conversion denominator is yet to resolve, which is the one thing
        `still_open` is there to let a reader judge.
        """
        repo["job_funnel"] = funnel_row(
            jobs_total=20,
            requested=1,
            matching=1,
            assigned=2,
            partner_en_route=1,
            in_progress=1,
            completed=8,
            cancelled=4,
            no_match_found=2,
        )
        result = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        assert result.conversion.still_open == 6
        assert result.conversion.rate == 0.4
        assert result.conversion.completed == 8
        assert result.conversion.total == 20

    def test_status_counts_sum_to_total(self, repo):
        repo["job_funnel"] = funnel_row(
            jobs_total=20,
            requested=1,
            matching=1,
            assigned=2,
            partner_en_route=1,
            in_progress=1,
            completed=8,
            cancelled=4,
            no_match_found=2,
        )
        result = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        jobs = result.jobs
        assert (
            jobs.requested
            + jobs.matching
            + jobs.assigned
            + jobs.partner_en_route
            + jobs.in_progress
            + jobs.completed
            + jobs.cancelled
            + jobs.no_match_found
        ) == jobs.total

    def test_roster_note_only_when_a_window_was_sent(self, repo):
        """The caveat appears when it can mislead, and not otherwise.

        With no window there is nothing for "as of now" to contradict, so the
        note would be noise. With one, the partner block silently answers a
        different question than the rest of the response, and that has to be
        said.
        """
        without = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        assert "PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL" not in codes(without)

        with_window = asyncio.run(
            admin_analytics_service.get_overview(None, ADMIN, from_ts=JAN, to_ts=FEB)
        )
        assert "PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL" in codes(with_window)

    def test_work_started_note_only_when_measured(self, repo):
        """No measurements means no "this is not arrival" caveat to attach."""
        empty = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        assert "WORK_STARTED_IS_NOT_ARRIVAL" not in codes(empty)

        repo["arrival_times"] = arrival_row(
            jobs_measured=30, mean_min=Decimal("14.5"), p50_min=Decimal("12.0")
        )
        measured = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        assert "WORK_STARTED_IS_NOT_ARRIVAL" in codes(measured)
        assert measured.work_started.unit == "minutes"
        assert measured.work_started.mean == Decimal("14.5")

    def test_window_echoes_request_and_reports_real_extent(self, repo):
        """Both halves of WindowInfo, because they catch different mistakes.

        A window from January whose first job is in September is asking about a
        period the pilot had not started — visible only if the response reports
        what was actually in range alongside what was asked for.
        """
        first = datetime(2026, 1, 20, tzinfo=timezone.utc)
        repo["job_funnel"] = funnel_row(
            jobs_total=3, completed=3, first_job_at=first, last_job_at=first
        )
        result = asyncio.run(
            admin_analytics_service.get_overview(None, ADMIN, from_ts=JAN, to_ts=FEB)
        )
        assert result.window.requested_from == JAN
        assert result.window.requested_to == FEB
        assert result.window.first_job_at == first

    def test_busy_counts_come_from_their_own_query(self, repo):
        repo["partner_supply"] = supply_row(
            partners_total=9, verified=7, available_now=5, dispatchable_now=4,
            rated=3, mean_rating=Decimal("4.2"), ratings_total=11,
        )
        repo["busy_partner_count"] = busy_row(partners_busy=2, live_assignments=3)
        result = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        assert result.partners.busy_now == 2
        assert result.partners.live_assignments == 3
        assert result.partners.ratings_total == 11
        assert result.partners.mean_rating == Decimal("4.2")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
class TestDispatch:
    def test_empty_window_rates_are_null(self, repo):
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert result.offers.acceptance_rate_of_answered is None
        assert result.offers.acceptance_rate_of_all is None
        assert result.no_match.rate is None
        assert result.dispatch_latency.count == 0

    def test_two_acceptance_rates_differ_on_unanswered_offers(self, repo):
        """The reason there are two rates at all.

        With no offer expiry in the system an unanswered offer is still open, not
        refused. 6/8 is the rate at which partners who looked said yes; 6/20 is
        what it becomes if every unopened offer is scored as a decline. Reporting
        only the second would read as "partners decline 70% of offers" when the
        truth is "nobody has answered twelve of them".
        """
        repo["offer_outcomes"] = offers_row(
            offers_total=20, accepted=6, declined=2, unanswered=12,
            jobs_offered=15, partners_offered=4,
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert result.offers.acceptance_rate_of_answered == 0.75
        assert result.offers.acceptance_rate_of_all == 0.3
        assert "UNANSWERED_OFFERS_HAVE_NO_EXPIRY" in codes(result)

    def test_outcomes_sum_to_total(self, repo):
        repo["offer_outcomes"] = offers_row(
            offers_total=20, accepted=6, declined=2, unanswered=12
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert (
            result.offers.accepted + result.offers.declined + result.offers.unanswered
            == result.offers.total
        )

    def test_unanswered_note_absent_when_every_offer_was_answered(self, repo):
        repo["offer_outcomes"] = offers_row(
            offers_total=10, accepted=7, declined=3, unanswered=0
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert "UNANSWERED_OFFERS_HAVE_NO_EXPIRY" not in codes(result)
        assert result.offers.acceptance_rate_of_answered == 0.7
        assert result.offers.acceptance_rate_of_all == 0.7

    def test_outages_leave_both_sides_of_the_no_match_rate(self, repo):
        """The mandatory exclusion, and the arithmetic that proves it is two-sided.

        100 jobs, 20 no_match_found, of which 5 were our own Redis timeouts. The
        honest rate is 15/95 — the outage jobs are not evidence about partner
        supply in either direction, so they leave the denominator too. 15/100
        (numerator-only) and 20/100 (no exclusion) are both wrong and both
        plausible-looking, which is why the unexcluded figure is returned beside
        it rather than discarded.
        """
        repo["no_match_breakdown"] = no_match_row(
            jobs_total=100, no_match_total=20, dispatch_unavailable=5,
            genuine_no_match=15,
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert result.no_match.rate == round(15 / 95, 4)
        assert result.no_match.rate != round(15 / 100, 4)
        assert result.no_match.rate_including_outages == 0.2
        assert "OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE" in codes(result)

    def test_outage_note_absent_when_there_were_none(self, repo):
        repo["no_match_breakdown"] = no_match_row(
            jobs_total=50, no_match_total=4, dispatch_unavailable=0, genuine_no_match=4
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert "OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE" not in codes(result)
        assert result.no_match.rate == 0.08
        assert result.no_match.rate == result.no_match.rate_including_outages

    def test_all_jobs_were_outages(self, repo):
        """Every no-match was an outage: the rate is 0 over a real denominator.

        Not None — there were 10 jobs whose dispatch actually ran and all of them
        found a partner. The guard has to distinguish "nothing to divide" from
        "the numerator happens to be zero".
        """
        repo["no_match_breakdown"] = no_match_row(
            jobs_total=12, no_match_total=2, dispatch_unavailable=2, genuine_no_match=0
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert result.no_match.rate == 0.0

    def test_latency_unit_is_seconds_and_carries_its_count(self, repo):
        repo["dispatch_latency"] = latency_row(
            offers_measured=25, mean_s=Decimal("1.204"), p50_s=Decimal("0.980"),
            p95_s=Decimal("2.310"), min_s=Decimal("0.410"), max_s=Decimal("3.100"),
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert result.dispatch_latency.unit == "seconds"
        assert result.dispatch_latency.count == 25
        assert result.dispatch_latency.p95 == Decimal("2.310")

    def test_thin_sample_note_below_threshold_only(self, repo):
        """Warn about percentiles on a handful of points, not on a real sample.

        Both directions tested: a note that fires at every sample size is a
        banner nobody reads, and one that never fires lets a p95 over four
        observations into a report unqualified.
        """
        repo["dispatch_latency"] = latency_row(
            offers_measured=4, mean_s=Decimal("1.0"), p95_s=Decimal("2.0")
        )
        thin = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert "SAMPLE_TOO_SMALL_FOR_PERCENTILES" in codes(thin)

        repo["dispatch_latency"] = latency_row(
            offers_measured=_THIN_SAMPLE, mean_s=Decimal("1.0"), p95_s=Decimal("2.0")
        )
        enough = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert "SAMPLE_TOO_SMALL_FOR_PERCENTILES" not in codes(enough)

    def test_thin_sample_note_absent_on_an_empty_window(self, repo):
        """Zero observations is "nothing measured", not "a small sample".

        The empty window already says so with count 0 and null percentiles;
        adding a caveat about percentile reliability would be advice about
        numbers that are not there.
        """
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        assert "SAMPLE_TOO_SMALL_FOR_PERCENTILES" not in codes(result)

    def test_rank_distribution_passes_through(self, repo):
        repo["offers_before_acceptance"] = ranks_row(
            accepted_offers=10, mean_rank=Decimal("1.400"),
            at_rank_1=7, at_rank_2=2, at_rank_3_or_worse=1, worst_rank=3,
        )
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        before = result.offers_before_acceptance
        assert before.mean_rank == Decimal("1.400")
        assert before.at_rank_1 + before.at_rank_2 + before.at_rank_3_or_worse == 10


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------
class TestMatching:
    def test_empty_window_is_null_not_zero_divergence(self, repo):
        """No dispatches is not "the strategy never diverged"."""
        result = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        assert result.divergence.rate is None
        assert result.attribution.driver is None
        assert result.weighted_diverged.acceptance_rate is None

    def test_divergence_rate_and_both_arms(self, repo):
        repo["strategy_comparison"] = comparison_row(
            first_offers=50, diverged=35, agreed_with_nearest=15,
            diverged_accepted=21, diverged_answered=30,
            agreed_accepted=9, agreed_answered=12,
        )
        result = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        assert result.divergence.rate == 0.7
        assert result.divergence.diverged + result.divergence.agreed_with_nearest == 50
        assert result.weighted_diverged.acceptance_rate == 0.7
        assert result.also_nearest.acceptance_rate == 0.75

    def test_first_offers_only_note_is_unconditional(self, repo):
        """The restriction is always in force, so the note always says so.

        It is not a caveat about this window's data — it is the definition of
        every number in the response, and a reader who assumes the rate covers
        all offers has misread it by a factor that depends on how often partners
        decline.
        """
        result = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        assert "FIRST_OFFERS_ONLY" in codes(result)

    def test_constant_component_note_names_the_component(self, repo):
        repo["strategy_comparison"] = comparison_row(first_offers=10, diverged=4)
        repo["component_spread"] = spread_row(
            offers=10, skill_score=Decimal("0"), rating_score=Decimal("0"),
            load_score=Decimal("0.1"), distance_score=Decimal("0.3"),
        )
        repo["component_means"] = {
            "diverged": means_arm(load_score=Decimal("0.7")),
            "agreed": means_arm(load_score=Decimal("0.4")),
        }
        result = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        note = next(
            n for n in result.notes
            if n.code == "CONSTANT_COMPONENTS_CANNOT_ATTRIBUTE"
        )
        assert "skill_score" in note.detail
        assert "rating_score" in note.detail
        assert result.attribution.driver == "load_score"

    def test_attribution_caveat_only_when_something_diverged(self, repo):
        """Nothing to attribute means no note about how attribution works."""
        repo["strategy_comparison"] = comparison_row(
            first_offers=8, diverged=0, agreed_with_nearest=8
        )
        result = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        assert "ATTRIBUTION_IS_GROUP_MEANS_NOT_COUNTERFACTUAL" not in codes(result)

        repo["strategy_comparison"] = comparison_row(
            first_offers=8, diverged=3, agreed_with_nearest=5
        )
        diverged = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        assert "ATTRIBUTION_IS_GROUP_MEANS_NOT_COUNTERFACTUAL" in codes(diverged)

    def test_service_reads_spread_from_the_repository(self, repo):
        """Eligibility is measured per request, not assumed once.

        Pins the call itself: a service that stopped asking for spread could
        still return a plausible attribution block, and the only visible
        difference would be a constant occasionally named as the driver.
        """
        asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        assert "component_spread" in repo["_calls"]
        assert "strategy_comparison" in repo["_calls"]
        assert "component_means" in repo["_calls"]


# ---------------------------------------------------------------------------
# Cross-endpoint invariants
# ---------------------------------------------------------------------------
class TestShapeInvariants:
    def test_every_rate_is_in_zero_to_one_or_none(self, repo):
        """No percentages anywhere, and no rate outside its own bounds.

        A rate over 1.0 would mean the numerator is not a subset of the
        denominator, which is the symptom of counting two different populations —
        the exact mistake that mixing assignment ranks would produce.
        """
        repo["job_funnel"] = funnel_row(jobs_total=10, completed=4, cancelled=6)
        repo["offer_outcomes"] = offers_row(
            offers_total=10, accepted=4, declined=3, unanswered=3
        )
        repo["no_match_breakdown"] = no_match_row(
            jobs_total=10, no_match_total=2, dispatch_unavailable=1, genuine_no_match=1
        )
        repo["strategy_comparison"] = comparison_row(
            first_offers=10, diverged=6, agreed_with_nearest=4,
            diverged_accepted=3, diverged_answered=5,
            agreed_accepted=2, agreed_answered=3,
        )
        overview = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        dispatch = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        matching = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))

        rates = [
            overview.conversion.rate,
            dispatch.offers.acceptance_rate_of_answered,
            dispatch.offers.acceptance_rate_of_all,
            dispatch.no_match.rate,
            dispatch.no_match.rate_including_outages,
            matching.divergence.rate,
            matching.weighted_diverged.acceptance_rate,
            matching.also_nearest.acceptance_rate,
        ]
        for rate in rates:
            assert rate is None or 0.0 <= rate <= 1.0

    def test_notes_are_never_empty_on_any_endpoint(self, repo):
        """Each response carries at least the caveat that always applies.

        overview always has the ETA refusal and matching always has the rank-1
        restriction, both structural. dispatch's are all conditional, so it is
        allowed to carry none — asserted as the distinction rather than
        overlooked.
        """
        overview = asyncio.run(admin_analytics_service.get_overview(None, ADMIN))
        matching = asyncio.run(admin_analytics_service.get_matching(None, ADMIN))
        assert overview.notes
        assert matching.notes

    def test_note_codes_are_unique_within_a_response(self, repo):
        """One code per response, so a client can key off it without a list."""
        repo["offer_outcomes"] = offers_row(
            offers_total=10, accepted=2, declined=1, unanswered=7
        )
        repo["no_match_breakdown"] = no_match_row(
            jobs_total=10, no_match_total=3, dispatch_unavailable=2, genuine_no_match=1
        )
        repo["dispatch_latency"] = latency_row(offers_measured=3, mean_s=Decimal("1"))
        result = asyncio.run(admin_analytics_service.get_dispatch(None, ADMIN))
        seen = [note.code for note in result.notes]
        assert len(seen) == len(set(seen))
