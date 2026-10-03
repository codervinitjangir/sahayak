"""
Business rules for the admin analytics endpoints.

What a "business rule" means in a read-only feature is narrower than usual and
worth stating, because it is the reason this module exists rather than the
handlers calling the repository directly:

  1. **Division.** Every rate in this feature has a denominator that can be
     zero, and on a pilot-sized dataset frequently is. `_rate` returns None
     rather than raising or returning 0.0, which is the single most important
     line in the file — a 0.0 acceptance rate on zero offers is a false claim
     about partner behaviour, and it is the shape a reader is least likely to
     question.
  2. **Which denominator.** Acceptance rate over answered offers rather than all
     offers; no-match rate with outage jobs removed from both sides. These are
     metric *definitions*, and the whole point of putting them here is that they
     are stated once, in Python, next to the reasoning, instead of being
     re-derived by whoever writes the report.
  3. **Deciding what cannot be computed, and saying so.** Three of the PRD's
     metrics are not fully computable from what the system stores. The rule is
     that each returns null with a note naming the missing input — never a
     plausible-looking substitute.

Nothing here writes, so there is no transaction boundary to own. The session is
used for reads and never committed or rolled back.

**On the window and why it is not optional in practice.** The default is every
job ever requested, which is the right default for a tool with no users yet and
the wrong thing to quote in a report. This database holds the QA harnesses' jobs
and has held the load harness's synthetic ones, so an all-time divergence rate
is a statistic about the test suite. The window parameters exist so the
evaluation can name the pilot period explicitly, and `WindowInfo.first_job_at`
is returned so the reader can see what was actually in range.
"""
import time
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import analytics_repository
from app.schemas.analytics import (
    AnalyticsDispatch,
    AnalyticsMatching,
    AnalyticsNote,
    AnalyticsOverview,
    ComponentAttribution,
    ConversionStats,
    DivergenceStats,
    DurationStats,
    JobsByStatus,
    NoMatchStats,
    OfferOutcomes,
    OffersBeforeAcceptance,
    PartnerSupply,
    StrategyArm,
    WindowInfo,
)
from app.services.auth_service import Identity
from app.utils.errors import BadRequestError, ErrorCode
from app.utils.logging import log_event

# Below this many observations, a p95 is an order statistic of a handful of
# points and says more about the sample than the system. The threshold is a
# judgement, not a standard — it exists so the response says "treat this
# cautiously" rather than leaving a reader to notice the count themselves.
_THIN_SAMPLE = 20

# The four keys of job_assignments.score_components. Spelled here as well as in
# app/utils/scoring.py because this module reads them out of stored JSONB, where
# they are historical data rather than a live contract: renaming one in scoring
# would not rename it in rows already written, so the two lists are allowed to
# diverge and this one follows the column.
_COMPONENTS = ("distance_score", "load_score", "skill_score", "rating_score")

# distance_score is excluded from attribution by definition, not by measurement.
# The baseline *is* nearest-first, so a diverged pick is necessarily worse on
# distance; naming distance as the driver of a divergence would be naming the
# thing that was overridden as the thing that did the overriding.
_ATTRIBUTABLE = ("load_score", "skill_score", "rating_score")


def _rate(numerator: Optional[int], denominator: Optional[int]) -> Optional[float]:
    """numerator / denominator, or None when there is nothing to divide.

    None, not 0.0. The two are different claims — "no offers were accepted" and
    "there were no offers" — and the second rendered as the first is the
    specific failure this feature is most exposed to, since almost every
    denominator here is small enough to be zero on a real window.
    """
    if not denominator:
        return None
    return round((numerator or 0) / denominator, 4)


def _duration(row: dict[str, Any], *, unit: str, count_key: str) -> DurationStats:
    """Reshape an aggregate row into DurationStats.

    The percentile columns are already NULL from Postgres when the input was
    empty — `avg` and `percentile_cont` over no rows return NULL rather than 0 —
    so nothing is being coerced here. This only renames.
    """
    count = int(row.get(count_key) or 0)
    return DurationStats(
        count=count,
        mean=row.get("mean_s") if unit == "seconds" else row.get("mean_min"),
        min=row.get("min_s") if unit == "seconds" else row.get("min_min"),
        p50=row.get("p50_s") if unit == "seconds" else row.get("p50_min"),
        p95=row.get("p95_s") if unit == "seconds" else row.get("p95_min"),
        max=row.get("max_s") if unit == "seconds" else row.get("max_min"),
        unit=unit,
    )


def _validate_window(
    from_ts: Optional[datetime], to_ts: Optional[datetime]
) -> None:
    """Refuse an inverted window instead of answering it.

    An inverted window has an honest answer — no jobs match — and returning it
    would be defensible. Refused anyway: a report of zeros reads as a finding
    about the pilot, and the one thing this feature must not do is produce a
    number that looks like a measurement and is not. A 400 names the mistake at
    the point it was made.

    Equal bounds are allowed and are not the same mistake. The window is
    half-open, so from == to is an empty range that someone asked for
    deliberately, and it answers with zeros that mean what they say.
    """
    if from_ts is not None and to_ts is not None and from_ts > to_ts:
        raise BadRequestError(
            ErrorCode.INVALID_DATE_RANGE,
            "The 'from' timestamp must not be later than 'to'.",
        )


def _window_info(
    from_ts: Optional[datetime],
    to_ts: Optional[datetime],
    funnel: Optional[dict[str, Any]] = None,
) -> WindowInfo:
    return WindowInfo(
        requested_from=from_ts,
        requested_to=to_ts,
        first_job_at=(funnel or {}).get("first_job_at"),
        last_job_at=(funnel or {}).get("last_job_at"),
    )


def _thin_sample_note(count: int, what: str) -> Optional[AnalyticsNote]:
    if count == 0 or count >= _THIN_SAMPLE:
        return None
    return AnalyticsNote(
        code="SAMPLE_TOO_SMALL_FOR_PERCENTILES",
        detail=(
            f"{what} is computed over {count} observations. The mean is usable; "
            f"p50 and p95 over fewer than {_THIN_SAMPLE} points describe the "
            "sample rather than the system and should not be quoted as "
            "percentiles."
        ),
    )


def _log(endpoint: str, *, identity: Identity, started: float, **fields: Any) -> None:
    """One audit line per analytics read.

    Logged at INFO with the admin's own id, because these three routes are the
    only ones in the system that return data about every partner and every
    customer at once. Who ran a fleet-wide read, and over what window, is worth
    having in the log even though the request changed nothing — a read of this
    breadth is the kind of access an incident review asks about afterwards, and
    "nothing was modified" is not an answer to "who looked".
    """
    log_event(
        "admin_analytics_read",
        endpoint=endpoint,
        actor_role="admin",
        admin_id=str(identity.local_id),
        auth_user_id=str(identity.auth_user_id),
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
        **fields,
    )


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------
async def get_overview(
    db: AsyncSession,
    identity: Identity,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> AnalyticsOverview:
    """Job funnel, pilot conversion, current roster, and time to work starting.

    Carries the ETA-accuracy refusal, because this is the endpoint that reports
    the metric it stands in for.
    """
    started = time.perf_counter()
    _validate_window(from_ts, to_ts)

    funnel = await analytics_repository.job_funnel(db, from_ts=from_ts, to_ts=to_ts)
    supply = await analytics_repository.partner_supply(db)
    busy = await analytics_repository.busy_partner_count(db)
    offers = await analytics_repository.offer_outcomes(
        db, from_ts=from_ts, to_ts=to_ts
    )
    arrival = await analytics_repository.arrival_times(
        db, from_ts=from_ts, to_ts=to_ts
    )

    jobs = JobsByStatus(
        total=funnel["jobs_total"],
        requested=funnel["requested"],
        matching=funnel["matching"],
        assigned=funnel["assigned"],
        partner_en_route=funnel["partner_en_route"],
        in_progress=funnel["in_progress"],
        completed=funnel["completed"],
        cancelled=funnel["cancelled"],
        no_match_found=funnel["no_match_found"],
    )

    # Open means "can still reach completed". no_match_found and cancelled
    # cannot — both are terminal in ALLOWED_TRANSITIONS — so they belong to the
    # denominator as settled outcomes, not to the in-flight count.
    still_open = (
        jobs.requested
        + jobs.matching
        + jobs.assigned
        + jobs.partner_en_route
        + jobs.in_progress
    )

    work_started = _duration(arrival, unit="minutes", count_key="jobs_measured")

    notes: list[AnalyticsNote] = [
        AnalyticsNote(
            code="ETA_ACCURACY_NOT_COMPUTABLE",
            detail=(
                "Actual-versus-estimated arrival cannot be computed: nothing in "
                "the system has ever written an arrival estimate. "
                "job_assignments.estimated_arrival_min exists in the schema and "
                "is populated by no code path, which this window confirms — "
                f"{offers['with_eta_estimate']} of {offers['offers_total']} "
                "offers carry one. The estimate side of the metric is missing, "
                "not the actual side; `work_started` below is the observable "
                "half. Reported as null rather than substituted."
            ),
        ),
    ]

    if work_started.count:
        notes.append(
            AnalyticsNote(
                code="WORK_STARTED_IS_NOT_ARRIVAL",
                detail=(
                    "`work_started` measures accept to the job entering "
                    "'in_progress', which is the transition out of "
                    "'partner_en_route'. There is no 'arrived' status and no "
                    "arrival timestamp, so this includes any time between the "
                    "mechanic pulling up and starting work. It is a floor on "
                    "travel time, not a measurement of it."
                ),
            )
        )
        thin = _thin_sample_note(work_started.count, "work_started")
        if thin:
            notes.append(thin)

    if from_ts is not None or to_ts is not None:
        notes.append(
            AnalyticsNote(
                code="PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL",
                detail=(
                    "The `partners` block ignores the requested window. "
                    "partners holds no history — is_available is a current flag "
                    "and rating_avg a running aggregate — so there is no honest "
                    "way to report the roster as it stood during a past period. "
                    "These counts are as of now."
                ),
            )
        )

    _log(
        "overview",
        identity=identity,
        started=started,
        jobs_total=jobs.total,
        note_codes=",".join(note.code for note in notes),
    )

    return AnalyticsOverview(
        window=_window_info(from_ts, to_ts, funnel),
        jobs=jobs,
        conversion=ConversionStats(
            completed=jobs.completed,
            total=jobs.total,
            still_open=still_open,
            rate=_rate(jobs.completed, jobs.total),
        ),
        partners=PartnerSupply(
            partners_total=supply["partners_total"],
            verified=supply["verified"],
            available_now=supply["available_now"],
            dispatchable_now=supply["dispatchable_now"],
            busy_now=busy["partners_busy"],
            live_assignments=busy["live_assignments"],
            rated=supply["rated"],
            ratings_total=int(supply["ratings_total"] or 0),
            mean_rating=supply["mean_rating"],
        ),
        work_started=work_started,
        eta_accuracy=None,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
async def get_dispatch(
    db: AsyncSession,
    identity: Identity,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> AnalyticsDispatch:
    """Latency, offer outcomes, offers-before-acceptance, and the no-match split."""
    started = time.perf_counter()
    _validate_window(from_ts, to_ts)

    latency = await analytics_repository.dispatch_latency(
        db, from_ts=from_ts, to_ts=to_ts
    )
    outcomes = await analytics_repository.offer_outcomes(
        db, from_ts=from_ts, to_ts=to_ts
    )
    ranks = await analytics_repository.offers_before_acceptance(
        db, from_ts=from_ts, to_ts=to_ts
    )
    no_match = await analytics_repository.no_match_breakdown(
        db, from_ts=from_ts, to_ts=to_ts
    )

    answered = outcomes["accepted"] + outcomes["declined"]
    offers = OfferOutcomes(
        total=outcomes["offers_total"],
        accepted=outcomes["accepted"],
        declined=outcomes["declined"],
        unanswered=outcomes["unanswered"],
        jobs_offered=outcomes["jobs_offered"],
        partners_offered=outcomes["partners_offered"],
        acceptance_rate_of_answered=_rate(outcomes["accepted"], answered),
        acceptance_rate_of_all=_rate(outcomes["accepted"], outcomes["offers_total"]),
    )

    # Outages leave the denominator as well as the numerator. See NoMatchStats.
    eligible_jobs = no_match["jobs_total"] - no_match["dispatch_unavailable"]
    dispatch_latency = _duration(latency, unit="seconds", count_key="offers_measured")

    notes: list[AnalyticsNote] = []

    if offers.unanswered:
        notes.append(
            AnalyticsNote(
                code="UNANSWERED_OFFERS_HAVE_NO_EXPIRY",
                detail=(
                    f"{offers.unanswered} of {offers.total} offers have never "
                    "been answered. There is no offer timeout or expiry in the "
                    "system, so these are still open and will remain open "
                    "indefinitely — they are not refusals. Quote "
                    "acceptance_rate_of_answered; acceptance_rate_of_all treats "
                    "every unopened offer as a decline."
                ),
            )
        )

    if no_match["dispatch_unavailable"]:
        notes.append(
            AnalyticsNote(
                code="OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE",
                detail=(
                    f"{no_match['dispatch_unavailable']} job(s) reached "
                    "no_match_found because the partner location service could "
                    "not be reached, not because no partner was available. Both "
                    "causes share the status by design (ADR-016) and are "
                    "separated by the history note. These are excluded from "
                    "`rate` on both sides of the division — a job whose dispatch "
                    "never ran is not evidence about partner supply in either "
                    "direction. `rate_including_outages` is given for comparison."
                ),
            )
        )

    thin = _thin_sample_note(dispatch_latency.count, "dispatch_latency")
    if thin:
        notes.append(thin)

    _log(
        "dispatch",
        identity=identity,
        started=started,
        offers_total=offers.total,
        note_codes=",".join(note.code for note in notes),
    )

    return AnalyticsDispatch(
        window=_window_info(from_ts, to_ts),
        dispatch_latency=dispatch_latency,
        offers=offers,
        offers_before_acceptance=OffersBeforeAcceptance(
            accepted_offers=ranks["accepted_offers"],
            mean_rank=ranks["mean_rank"],
            at_rank_1=ranks["at_rank_1"],
            at_rank_2=ranks["at_rank_2"],
            at_rank_3_or_worse=ranks["at_rank_3_or_worse"],
            worst_rank=ranks["worst_rank"],
        ),
        no_match=NoMatchStats(
            total=no_match["no_match_total"],
            genuine=no_match["genuine_no_match"],
            dispatch_unavailable=no_match["dispatch_unavailable"],
            jobs_in_window=no_match["jobs_total"],
            rate=_rate(no_match["genuine_no_match"], eligible_jobs),
            rate_including_outages=_rate(
                no_match["no_match_total"], no_match["jobs_total"]
            ),
        ),
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Matching strategy
# ---------------------------------------------------------------------------
def _arm(
    offers: int, answered: int, accepted: int, means: Optional[dict[str, Any]]
) -> StrategyArm:
    return StrategyArm(
        offers=offers,
        answered=answered,
        accepted=accepted,
        acceptance_rate=_rate(accepted, answered),
        mean_matching_score=(means or {}).get("matching_score"),
        mean_distance_score=(means or {}).get("distance_score"),
        mean_load_score=(means or {}).get("load_score"),
        mean_skill_score=(means or {}).get("skill_score"),
        mean_rating_score=(means or {}).get("rating_score"),
    )


def _attribute(
    comparison: dict[str, Any],
    means: dict[str, Optional[dict[str, Any]]],
    spread: dict[str, Any],
) -> ComponentAttribution:
    """Name the component that paid for overriding distance, or name none.

    Three things have to hold before a component can be called the driver, and
    each of them rules out a wrong answer that would otherwise look plausible:

      1. There has to be divergence to explain. With none, there is no
         overriding and no driver, and a "driver" computed from an empty group
         would be whichever component happened to have the largest mean.
      2. The component has to have *varied* in this window (stddev > 0). A
         component that took the same value for every decision cannot have
         separated two candidates whatever its level, and two components here are
         routinely in that state: skill_score always, because skill is a hard
         filter and every ranked candidate matches (ADR-009); rating_score
         whenever no partner had been rated yet, because an unrated partner
         scores a fixed constant. Both would otherwise win on mean — skill_score
         is 1.0, the highest value any component can take.
      3. The delta has to be positive. Diverged minus agreed: the component must
         be *higher* on the picks that overrode distance. A negative delta on
         every component means the divergence is not explained by the components
         at all, which is a real possibility worth reporting as `driver: null`
         rather than resolving to "least negative".

    This is a difference of means, not a per-job counterfactual, and it cannot be
    made into one from what is stored: `score_components` is written for the
    partner who was offered the job and never for the nearest partner who was
    not, so there is no row to subtract. Recording the runner-up's components
    would close that, and is noted as a gap rather than built here.
    """
    diverged_offers = comparison["diverged"]
    diverged_means = means.get("diverged")
    agreed_means = means.get("agreed")

    stddev = {key: spread.get(key) for key in _COMPONENTS}
    # `> 0` and `== 0` rather than truthiness, and the None case excluded from
    # both lists rather than falling into either. stddev_samp is NULL for a
    # single observation, which means "unknown spread" — neither varied nor
    # constant — and a one-offer window must not report skill_score as eligible
    # just because its spread could not be measured.
    eligible = [
        key
        for key in _ATTRIBUTABLE
        if stddev.get(key) is not None and stddev[key] > 0
    ]
    constant = [
        key
        for key in _COMPONENTS
        if stddev.get(key) is not None and stddev[key] == 0
    ]

    deltas: dict[str, Optional[Decimal]] = {}
    for key in _COMPONENTS:
        here = (diverged_means or {}).get(key)
        there = (agreed_means or {}).get(key)
        deltas[key] = (here - there) if (here is not None and there is not None) else None

    driver: Optional[str] = None
    if diverged_offers:
        candidates = [
            (key, deltas[key])
            for key in eligible
            if deltas[key] is not None and deltas[key] > 0
        ]
        if candidates:
            driver = max(candidates, key=lambda pair: pair[1])[0]

    return ComponentAttribution(
        diverged_offers=diverged_offers,
        deltas=deltas,
        stddev=stddev,
        eligible_components=eligible,
        constant_components=constant,
        driver=driver,
    )


async def get_matching(
    db: AsyncSession,
    identity: Identity,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> AnalyticsMatching:
    """The weighted strategy against the nearest-partner baseline.

    This is the endpoint the project's evaluation rests on, and every number in
    it is restricted to `assignment_rank = 1`. See DivergenceStats for why.
    """
    started = time.perf_counter()
    _validate_window(from_ts, to_ts)

    comparison = await analytics_repository.strategy_comparison(
        db, from_ts=from_ts, to_ts=to_ts
    )
    means = await analytics_repository.component_means(
        db, from_ts=from_ts, to_ts=to_ts
    )
    spread = await analytics_repository.component_spread(
        db, from_ts=from_ts, to_ts=to_ts
    )

    attribution = _attribute(comparison, means, spread)

    notes: list[AnalyticsNote] = [
        AnalyticsNote(
            code="FIRST_OFFERS_ONLY",
            detail=(
                "Every number here is restricted to the first offer of each job "
                "(assignment_rank = 1). On a later offer was_baseline_choice "
                "means 'also the nearest of those still eligible', which is a "
                "different question about a smaller candidate set; mixing ranks "
                "would compare the weighted strategy against a baseline that "
                "changes definition partway through the sample."
            ),
        ),
    ]

    if attribution.constant_components:
        notes.append(
            AnalyticsNote(
                code="CONSTANT_COMPONENTS_CANNOT_ATTRIBUTE",
                detail=(
                    "These components took the same value for every decision in "
                    "this window and so cannot have separated two candidates, "
                    "whatever their mean: "
                    + ", ".join(attribution.constant_components)
                    + ". skill_score is constant by construction — skill is a "
                    "hard filter applied before scoring (ADR-009), so every "
                    "ranked candidate matches and the term is always 1.0. "
                    "rating_score is constant for any window in which no partner "
                    "had been rated, because an unrated partner scores a fixed "
                    "prior. Excluded from `driver`."
                ),
            )
        )

    if comparison["diverged"]:
        notes.append(
            AnalyticsNote(
                code="ATTRIBUTION_IS_GROUP_MEANS_NOT_COUNTERFACTUAL",
                detail=(
                    "`driver` is the component with the largest positive "
                    "difference between diverged and agreed picks — a difference "
                    "of group means, not a per-job comparison against the "
                    "partner who was passed over. The stronger version is not "
                    "computable from what is stored: score_components is written "
                    "for the partner who received the offer and never for the "
                    "nearest partner who did not, so there is no runner-up row "
                    "to subtract. Recording the baseline candidate's components "
                    "at dispatch time would close this."
                ),
            )
        )

    thin = _thin_sample_note(comparison["first_offers"], "the divergence rate")
    if thin:
        notes.append(thin)

    _log(
        "matching",
        identity=identity,
        started=started,
        first_offers=comparison["first_offers"],
        diverged=comparison["diverged"],
        driver=attribution.driver or "none",
        note_codes=",".join(note.code for note in notes),
    )

    return AnalyticsMatching(
        window=_window_info(from_ts, to_ts),
        divergence=DivergenceStats(
            first_offers=comparison["first_offers"],
            diverged=comparison["diverged"],
            agreed_with_nearest=comparison["agreed_with_nearest"],
            rate=_rate(comparison["diverged"], comparison["first_offers"]),
        ),
        weighted_diverged=_arm(
            offers=comparison["diverged"],
            answered=comparison["diverged_answered"],
            accepted=comparison["diverged_accepted"],
            means=means.get("diverged"),
        ),
        also_nearest=_arm(
            offers=comparison["agreed_with_nearest"],
            answered=comparison["agreed_answered"],
            accepted=comparison["agreed_accepted"],
            means=means.get("agreed"),
        ),
        attribution=attribution,
        notes=notes,
    )
