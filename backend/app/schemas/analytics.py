"""
Response shapes for the admin analytics endpoints.

Three responses, one per endpoint, built from small reusable blocks. Nothing
here is a request body — every input is a query parameter — so there is no
`extra="forbid"` to set and no validation to do beyond the window, which the
service checks because the rule (from <= to) spans two fields.

Two shape decisions apply throughout.

**Every rate is a float in 0..1 and is reported next to the two integers it came
from.** Never a percentage, never rounded to a display precision. A rate alone
is unusable in a report: 0.7 over ten jobs and 0.7 over ten thousand are the
same number and different findings, and the only way to tell is the denominator.
This also means a client never has to trust our division — it can recompute.

**Every block that cannot be computed is `null`, never zero and never omitted.**
An absent metric and a metric that measured zero are different claims, and the
one place this project has already been bitten was a stored zero that read as a
measurement (`rating_count`, ADR-018). `null` with a note beside it is the shape
that cannot be misread.

`notes` is the mechanism for that. Each note is a code and a sentence, attached
to the response that carries the affected numbers rather than left to a document
nobody reads next to the data. The codes are stable and machine-readable so the
evaluation write-up can key off them; the sentences are prose and may be
reworded, the same split as `event` and `message` in ADR-019.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class AnalyticsNote(BaseModel):
    """A caveat that travels with the numbers it qualifies."""

    code: str = Field(
        ...,
        description="Stable identifier for this caveat. Branch on this.",
        examples=["ETA_ACCURACY_NOT_COMPUTABLE"],
    )
    detail: str = Field(
        ...,
        description="Human-readable explanation. Prose; may be reworded.",
    )


class WindowInfo(BaseModel):
    """What was asked for, and what was actually in range.

    `requested_from`/`requested_to` echo the query parameters, including when
    they were absent — a report needs to state its own window, and a client that
    sent nothing should not have to know that nothing means all time.

    `first_job_at`/`last_job_at` are the real extent of the data inside that
    window, which is the more useful number and the one that catches an empty
    report: a window from January with `first_job_at` in September is asking
    about a period the pilot had not started.
    """

    requested_from: Optional[datetime] = None
    requested_to: Optional[datetime] = None
    first_job_at: Optional[datetime] = None
    last_job_at: Optional[datetime] = None


class DurationStats(BaseModel):
    """Count, mean and percentiles for one measured duration.

    `count` first and never optional: it is what makes the rest interpretable,
    and on a pilot-sized sample it is frequently the most important field in the
    block. Everything else is `None` when `count` is 0, because the mean of no
    observations is not 0.
    """

    count: int
    mean: Optional[Decimal] = None
    min: Optional[Decimal] = None
    p50: Optional[Decimal] = None
    p95: Optional[Decimal] = None
    max: Optional[Decimal] = None
    unit: str


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------
class JobsByStatus(BaseModel):
    """Current status of every job in the window.

    Current, not "ever reached": a completed job appears only under `completed`,
    having passed through `assigned` and `in_progress` on the way. The eight
    fields are the full status set from ALLOWED_TRANSITIONS, so they sum to
    `total`, which the live harness asserts.
    """

    total: int
    requested: int
    matching: int
    assigned: int
    partner_en_route: int
    in_progress: int
    completed: int
    cancelled: int
    no_match_found: int


class ConversionStats(BaseModel):
    """The PRD's pilot conversion: jobs that finished the job.

    `rate` is `completed / total`, which counts every job ever requested in the
    window including those still open. On a window that ends now, jobs mid-flight
    are in the denominator and cannot yet be in the numerator, so the rate is a
    floor rather than an estimate — `still_open` is reported so the size of that
    effect is visible instead of inferred.
    """

    completed: int
    total: int
    still_open: int
    rate: Optional[float] = None


class PartnerSupply(BaseModel):
    """The roster as it stands now. Never windowed — see the repository.

    `partners` holds no history: `is_available` is a current flag and
    `rating_avg` a running aggregate, so there is no honest way to report the
    roster during a past window. A window on the request does not apply to this
    block, and a note says so when one was sent.
    """

    partners_total: int
    verified: int
    available_now: int
    dispatchable_now: int
    busy_now: int
    live_assignments: int
    rated: int
    ratings_total: int
    mean_rating: Optional[Decimal] = None


class AnalyticsOverview(BaseModel):
    """GET /api/v1/admin/analytics/overview"""

    window: WindowInfo
    jobs: JobsByStatus
    conversion: ConversionStats
    partners: PartnerSupply
    # Accept -> work started. Not arrival: there is no arrived status and no
    # arrival timestamp, so this measures the transition into 'in_progress' and
    # is named for what it measures.
    work_started: DurationStats
    # Always null. The PRD asks for actual-vs-estimated arrival; nothing in the
    # system has ever written an estimate. See the note of the same name.
    eta_accuracy: None = None
    notes: list[AnalyticsNote] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
class OfferOutcomes(BaseModel):
    """Every offer in the window by what the partner did, and two rates.

    The three outcome counts are read from timestamps, not from
    `job_assignments.status`, which is overwritten when the job ends. They are
    mutually exclusive and sum to `total`.

    Two rates, because with no offer-expiry mechanism an unanswered offer is
    still open rather than refused:

      * `acceptance_rate_of_answered` = accepted / (accepted + declined). The
        rate at which partners who responded said yes. This is the one to quote.
      * `acceptance_rate_of_all` = accepted / total. Drags toward zero with
        every offer nobody has looked at, and is reported so the gap between the
        two is visible rather than a matter of which definition was used.
    """

    total: int
    accepted: int
    declined: int
    unanswered: int
    jobs_offered: int
    partners_offered: int
    acceptance_rate_of_answered: Optional[float] = None
    acceptance_rate_of_all: Optional[float] = None


class OffersBeforeAcceptance(BaseModel):
    """How far down the ranked list dispatch got before someone said yes.

    The distribution is reported with the mean because the mean hides the shape:
    1.4 is a different system depending on whether a few jobs needed six offers
    or a third needed two. Ranks are only meaningful for accepted offers; a job
    offered three times and never answered appears in `OfferOutcomes.unanswered`
    instead.
    """

    accepted_offers: int
    mean_rank: Optional[Decimal] = None
    at_rank_1: int
    at_rank_2: int
    at_rank_3_or_worse: int
    worst_rank: Optional[int] = None


class NoMatchStats(BaseModel):
    """`no_match_found` split by cause, and the rate with outages removed.

    A dispatch outage and an empty radius share the status by design (ADR-016)
    and are separated by the history note. `rate` excludes outages from the
    numerator *and* the denominator: a job whose dispatch never ran is not
    evidence about partner availability in either direction, so it is not a data
    point rather than a negative one. `rate_including_outages` is given for
    comparison so the exclusion is auditable.
    """

    total: int
    genuine: int
    dispatch_unavailable: int
    jobs_in_window: int
    rate: Optional[float] = None
    rate_including_outages: Optional[float] = None


class AnalyticsDispatch(BaseModel):
    """GET /api/v1/admin/analytics/dispatch"""

    window: WindowInfo
    # requested_at -> first offer. Both ends are database-clock defaults, so
    # this is not measuring skew between the API process and Postgres.
    dispatch_latency: DurationStats
    offers: OfferOutcomes
    offers_before_acceptance: OffersBeforeAcceptance
    no_match: NoMatchStats
    notes: list[AnalyticsNote] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Matching strategy
# ---------------------------------------------------------------------------
class DivergenceStats(BaseModel):
    """How often the weighted pick was not the nearest partner.

    Over first offers only (`assignment_rank = 1`). On a later offer
    `was_baseline_choice` means "also nearest among those still eligible", which
    is a different question about a different candidate set, so including it
    would compare the weighted strategy against a baseline that changes
    definition partway through the sample.
    """

    first_offers: int
    diverged: int
    agreed_with_nearest: int
    rate: Optional[float] = None


class StrategyArm(BaseModel):
    """One side of the comparison: picks that diverged, or picks that agreed.

    `acceptance_rate` is over answered offers, matching
    `OfferOutcomes.acceptance_rate_of_answered`, so the two arms are compared on
    the same definition and neither is penalised for offers nobody has opened.
    """

    offers: int
    answered: int
    accepted: int
    acceptance_rate: Optional[float] = None
    mean_matching_score: Optional[Decimal] = None
    mean_distance_score: Optional[Decimal] = None
    mean_load_score: Optional[Decimal] = None
    mean_skill_score: Optional[Decimal] = None
    mean_rating_score: Optional[Decimal] = None


class ComponentAttribution(BaseModel):
    """Which scoring term paid for overriding distance.

    Attribution here is a difference of means between the two arms, not a
    per-job counterfactual. A diverged pick is by definition worse on distance
    than the nearest partner was, so the term that is systematically higher on
    diverged picks than on agreed ones is the term that bought the override.
    `deltas` is diverged minus agreed for each component, and `driver` names the
    largest positive one among the eligible components.

    `eligible_components` is the subset that varied at all in this window, from
    `stddev > 0`. A component that took the same value for every decision cannot
    have separated two candidates, so it cannot be the driver however large its
    mean. `skill_score` is always in that state by construction (hard filter,
    ADR-009) and `rating_score` is whenever no partner had been rated yet.

    `driver` is `None` whenever it cannot be named — no divergence, no eligible
    component, or no positive delta — rather than falling back to the largest
    mean, which would name a constant.
    """

    diverged_offers: int
    deltas: dict[str, Optional[Decimal]] = Field(default_factory=dict)
    stddev: dict[str, Optional[Decimal]] = Field(default_factory=dict)
    eligible_components: list[str] = Field(default_factory=list)
    constant_components: list[str] = Field(default_factory=list)
    driver: Optional[str] = None


class AnalyticsMatching(BaseModel):
    """GET /api/v1/admin/analytics/matching

    The endpoint the project's evaluation rests on: it is the only place the
    weighted strategy is compared against the nearest-partner baseline it was
    built to beat.
    """

    window: WindowInfo
    divergence: DivergenceStats
    weighted_diverged: StrategyArm
    also_nearest: StrategyArm
    attribution: ComponentAttribution
    notes: list[AnalyticsNote] = Field(default_factory=list)
