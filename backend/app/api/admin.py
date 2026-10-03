"""
Admin analytics: the three reports the project's evaluation is written from.

  GET /api/v1/admin/analytics/overview
  GET /api/v1/admin/analytics/dispatch
  GET /api/v1/admin/analytics/matching

**Every route here depends on `require_admin`, and that dependency is the whole
of the authorization boundary.** These are the only endpoints in the system that
return data spanning every customer and every partner at once — there is no
owner to compare against, no `local_id` to scope by, nothing downstream that
narrows the result. `require_admin`'s own docstring is explicit about the
consequence: a route that forgets it is wide open to any logged-in customer
rather than merely over-scoped. So the dependency is repeated per route rather
than set once on the router. `APIRouter(dependencies=[...])` would work and is
shorter, but it puts the guard somewhere other than where a reviewer looks for
it, and a new route added below would inherit protection silently instead of
stating it — which is fine until someone copies one route into a different
module and loses it in transit. The live harness asserts all three refuse a
`user` token and a `partner` token.

**Three endpoints rather than one.** They answer three different questions, they
are read by three different parts of the evaluation document, and each carries
its own `notes` naming what its own numbers cannot say. One combined response
would run every aggregate on every request — including the percentile scans —
to serve a reader who wanted one table, and would put the ETA-accuracy caveat
next to the divergence rate it has nothing to do with.

**The split is by question, not by cost.** `overview` is the funnel and the
roster: is the pilot moving jobs. `dispatch` is the engine's behaviour: how fast
offers go out, what partners do with them, how often nobody is found. `matching`
is the one comparison the project exists to make — the weighted strategy against
the nearest-partner baseline.

No pagination anywhere. Every response is a fixed set of aggregates whose size
does not grow with the data, which is the one shape in this API that genuinely
does not need it.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.analytics import (
    AnalyticsDispatch,
    AnalyticsMatching,
    AnalyticsOverview,
)
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.services import admin_analytics_service
from app.services.auth_service import Identity
from app.utils.auth import require_admin

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "`from` is later than `to`"},
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {"model": ErrorResponse, "description": "Caller is not a platform admin"},
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/admin/analytics",
    tags=["admin analytics"],
    responses=_ERROR_RESPONSES,
)

# The window parameters, declared once. Both optional, both naming
# `jobs.requested_at` in their descriptions rather than "the period", because a
# reader of the generated docs has to know which of a job's five timestamps the
# window is applied to before the numbers mean anything.
#
# Half-open: `from` is inclusive, `to` exclusive. Spelled out in the description
# because a caller building two adjacent monthly reports needs to know they
# partition rather than overlap, and that is not guessable.
_FROM_QUERY = Query(
    None,
    alias="from",
    description=(
        "Include jobs requested at or after this instant (ISO 8601). "
        "Applied to jobs.requested_at. Omit for no lower bound."
    ),
)
_TO_QUERY = Query(
    None,
    alias="to",
    description=(
        "Include jobs requested strictly before this instant (ISO 8601). "
        "Applied to jobs.requested_at, exclusive, so two adjacent windows "
        "partition the jobs between them. Omit for no upper bound."
    ),
)


@router.get(
    "/overview",
    response_model=ApiResponse[AnalyticsOverview],
    status_code=status.HTTP_200_OK,
    summary="Job funnel, pilot conversion, and current partner supply",
)
async def get_overview(
    from_ts: Optional[datetime] = _FROM_QUERY,
    to_ts: Optional[datetime] = _TO_QUERY,
    identity: Identity = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AnalyticsOverview]:
    """Where the pilot's jobs ended up, and what the roster looks like now.

    `jobs` is every job in the window by *current* status, so the eight counts
    sum to `total` — a completed job appears only under `completed`, not also
    under the statuses it passed through.

    `conversion` is the PRD's pilot conversion rate, `completed / total`. Jobs
    still in flight are in the denominator and cannot yet be in the numerator,
    so on a window ending now the rate is a floor; `still_open` is returned so
    the size of that effect is visible rather than inferred.

    `partners` is as of now and ignores the window — `partners` holds no history,
    so there is no honest way to report a past roster. A note says so whenever a
    window was actually sent.

    `eta_accuracy` is always null. The PRD asks for actual-versus-estimated
    arrival and no estimate has ever been written: `estimated_arrival_min` is
    populated by no code path, which the response demonstrates rather than
    asserts — `offers.with_eta_estimate` on the dispatch endpoint is the count.
    `work_started` is the observable half (accept to work beginning) and is named
    for what it measures, because there is no `arrived` status to measure
    arrival with.
    """
    result = await admin_analytics_service.get_overview(
        db, identity, from_ts=from_ts, to_ts=to_ts
    )
    return envelope(result)


@router.get(
    "/dispatch",
    response_model=ApiResponse[AnalyticsDispatch],
    status_code=status.HTTP_200_OK,
    summary="Dispatch latency, offer outcomes, and the no-match split",
)
async def get_dispatch(
    from_ts: Optional[datetime] = _FROM_QUERY,
    to_ts: Optional[datetime] = _TO_QUERY,
    identity: Identity = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AnalyticsDispatch]:
    """How the engine behaved: speed, partner response, and failure to match.

    `dispatch_latency` is requested-at to first-offer-sent, in seconds. Both
    ends are database-clock column defaults, so it is not measuring skew between
    the API process and Postgres.

    `offers` classifies every offer by what the partner did, read from
    `accepted_at`/`responded_at` rather than from `job_assignments.status` —
    that column is overwritten when the job ends, so a status-based count would
    miss every pending offer on a cancelled job. Two acceptance rates are
    returned: quote `acceptance_rate_of_answered`. There is no offer expiry in
    this system, so an unanswered offer is still open rather than refused, and
    `acceptance_rate_of_all` treats every one of them as a decline.

    `no_match.rate` excludes dispatch outages from the numerator *and* the
    denominator. A `no_match_found` caused by the location service being
    unreachable is not evidence about partner supply in either direction (ADR-016
    put both causes under one status by design, separated by the history note).
    `rate_including_outages` is returned beside it so the exclusion is auditable
    rather than taken on trust.
    """
    result = await admin_analytics_service.get_dispatch(
        db, identity, from_ts=from_ts, to_ts=to_ts
    )
    return envelope(result)


@router.get(
    "/matching",
    response_model=ApiResponse[AnalyticsMatching],
    status_code=status.HTTP_200_OK,
    summary="Weighted scoring against the nearest-partner baseline",
)
async def get_matching(
    from_ts: Optional[datetime] = _FROM_QUERY,
    to_ts: Optional[datetime] = _TO_QUERY,
    identity: Identity = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AnalyticsMatching]:
    """Did weighted scoring do anything a nearest-partner rule would not have?

    The endpoint the project's central claim rests on. Every dispatch records
    `was_baseline_choice` — whether the partner the weighted score picked was
    also the nearest eligible one — so the divergence rate is measured from
    production decisions rather than reconstructed by re-running the scorer
    against a world that has since moved.

    **Everything here is restricted to first offers (`assignment_rank = 1`), and
    that restriction is the metric's correctness, not a sampling convenience.**
    On a later offer `was_baseline_choice` means "also the nearest of those still
    eligible after the previous partner declined", which is a different question
    about a smaller candidate set; mixing ranks would compare the strategy
    against a baseline that changes definition partway through the sample.

    `weighted_diverged` and `also_nearest` are the two arms, compared on
    acceptance of answered offers so neither is penalised for offers nobody has
    opened.

    `attribution` names which scoring term paid for overriding distance, as a
    difference of group means — and names none when it cannot. A component that
    did not vary in the window cannot have separated two candidates whatever its
    level, which is not hypothetical: `skill_score` is the constant 1.0 by
    construction, since skill is a hard filter applied before scoring (ADR-009).
    Eligibility is read off measured spread, so `driver` can never be a constant.
    """
    result = await admin_analytics_service.get_matching(
        db, identity, from_ts=from_ts, to_ts=to_ts
    )
    return envelope(result)
