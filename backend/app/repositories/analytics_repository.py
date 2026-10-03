"""
Read-only aggregate queries behind the admin analytics endpoints.

Every function here returns one row of counts or percentiles for a time window.
Nothing in this module writes, so unlike the other repositories there is no
flush() to keep out of and no transaction boundary to respect — the service
still owns the session, it simply has nothing to commit.

Why raw `text()` rather than the ORM. These are aggregate queries over whole
tables: `count(*) FILTER (WHERE ...)`, `percentile_cont(...) WITHIN GROUP`, and
JSONB extraction. The ORM expresses all of it, but it expresses it as Python
that has to be read twice to see the SQL, and the SQL is the part under review —
these numbers go into the evaluation document, so the definition of each metric
needs to be legible to someone checking whether the number means what the report
claims. One `text()` block per metric, with the definition in a comment above
it, is the form that survives that review. `dispatch_repository` already uses
`text()` for the same reason (the GEOSEARCH-adjacent distance query).

Two conventions hold across every query here, and both are load-bearing:

**An offer's outcome is read from its timestamps, never its status.**
`job_assignments.status` is overwritten when the job ends: accepting then
completing leaves `'completed'`, and an owner cancelling overwrites every open
offer to `'cancelled'` (job_service.py:854). So `status = 'accepted'` counts
only offers that are *currently* live, and `status = 'offered'` misses every
pending offer on a cancelled job. `accepted_at` and `responded_at` are stamped
once and never cleared, which makes them the only reliable record of what the
partner actually did. This is the same defect that silently held `rating_count`
at zero (ADR-018) — a query matching on a status that something downstream had
already moved past.

  * accepted   -> accepted_at IS NOT NULL
  * declined   -> responded_at IS NOT NULL AND accepted_at IS NULL
  * unanswered -> responded_at IS NULL

**The window is applied to `jobs.requested_at`, never to the assignment.** An
offer belongs to the window its job was requested in, so a job requested just
before the boundary counts all of its offers or none of them. Windowing the
assignments instead would let one job's offers be split across two reports, and
then rank-1 would be in one and rank-2 in the other — which is exactly the
column the offers-before-acceptance metric is a mean of.
"""
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# The window predicate, spelled once. NULL on either side means unbounded, so
# the default (no query parameters) is every job ever requested.
#
# `>= :from_ts` and `< :to_ts` — half-open on purpose. Two adjacent windows
# built this way partition the jobs between them with no row counted twice and
# none dropped, which a closed upper bound would not do.
#
# **The casts are required, not decoration.** asyncpg uses the extended query
# protocol: every statement is PREPAREd before any value is bound, so Postgres
# has to infer each parameter's type from the SQL text alone. A bare
# `$1 IS NULL` carries no type information whatsoever, and Postgres refuses the
# statement with AmbiguousParameterError — on the unbounded call *and* on a call
# with both timestamps supplied, because the value never gets a chance to help.
# Spelling the type once per placeholder resolves it. This is an asyncpg-vs-
# psycopg2 difference: psycopg2 interpolates client-side and never sees it, so
# the same SQL pasted into a psql session or a psycopg2 script works fine.
_WINDOW = """
    (CAST(:from_ts AS timestamptz) IS NULL
         OR j.requested_at >= CAST(:from_ts AS timestamptz))
    AND (CAST(:to_ts AS timestamptz) IS NULL
         OR j.requested_at < CAST(:to_ts AS timestamptz))
"""

# Jobs whose no_match_found was a dispatch outage rather than an empty radius.
# Both end in the same status by design (ADR-016); the note is what separates
# them, and this is the query shape dispatch_service.py:448 documents as the one
# the evaluation should use. Counting these as "no partner was available" would
# report our own Redis timeouts as a finding about partner supply.
_OUTAGE_JOBS = """
    SELECT DISTINCT job_id
    FROM job_status_history
    WHERE status = 'no_match_found'
      AND note LIKE 'Dispatch unavailable:%'
"""


def _bind(
    from_ts: Optional[datetime], to_ts: Optional[datetime]
) -> dict[str, Any]:
    return {"from_ts": from_ts, "to_ts": to_ts}


async def _one(
    db: AsyncSession, sql: str, params: dict[str, Any]
) -> dict[str, Any]:
    """Run a single-row aggregate and return it as a plain dict.

    Aggregates without GROUP BY always return exactly one row — zero rows is not
    a case that can happen — so `.one()` rather than `.first()`, which would
    quietly turn a rewritten query into a None the caller has to guess about.
    """
    result = await db.execute(text(sql), params)
    return dict(result.mappings().one())


# ---------------------------------------------------------------------------
# Job funnel
# ---------------------------------------------------------------------------
async def job_funnel(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """Count jobs in the window by current status.

    Current status, not "ever reached" — a completed job passed through
    'assigned' and is not counted there. The statuses are listed explicitly
    rather than returned as a GROUP BY, so a status with no jobs appears as 0
    instead of being absent: a client rendering a funnel needs the zero.
    """
    sql = f"""
        SELECT
            count(*)                                              AS jobs_total,
            count(*) FILTER (WHERE j.status = 'requested')        AS requested,
            count(*) FILTER (WHERE j.status = 'matching')         AS matching,
            count(*) FILTER (WHERE j.status = 'assigned')         AS assigned,
            count(*) FILTER (WHERE j.status = 'partner_en_route') AS partner_en_route,
            count(*) FILTER (WHERE j.status = 'in_progress')      AS in_progress,
            count(*) FILTER (WHERE j.status = 'completed')        AS completed,
            count(*) FILTER (WHERE j.status = 'cancelled')        AS cancelled,
            count(*) FILTER (WHERE j.status = 'no_match_found')   AS no_match_found,
            min(j.requested_at)                                   AS first_job_at,
            max(j.requested_at)                                   AS last_job_at
        FROM jobs j
        WHERE {_WINDOW}
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


async def no_match_breakdown(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """Split no_match_found into "nobody available" and "dispatch was down".

    Returns both parts plus the total jobs in the window, because the rate the
    PRD asks for needs the outage jobs removed from the *denominator* too, not
    only the numerator. A job whose dispatch never ran is not evidence about
    partner availability in either direction, so it is not a data point.
    """
    sql = f"""
        SELECT
            count(*)                                           AS jobs_total,
            count(*) FILTER (
                WHERE j.status = 'no_match_found'
            )                                                  AS no_match_total,
            count(*) FILTER (
                WHERE j.status = 'no_match_found'
                  AND outage.job_id IS NOT NULL
            )                                                  AS dispatch_unavailable,
            count(*) FILTER (
                WHERE j.status = 'no_match_found'
                  AND outage.job_id IS NULL
            )                                                  AS genuine_no_match
        FROM jobs j
        LEFT JOIN ({_OUTAGE_JOBS}) outage ON outage.job_id = j.id
        WHERE {_WINDOW}
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


# ---------------------------------------------------------------------------
# Dispatch latency
# ---------------------------------------------------------------------------
async def dispatch_latency(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """Seconds from a job being requested to its first offer going out.

    `assignment_rank = 1` rather than `min(offered_at)`. The two pick the same
    row in a correct system, which is the point: rank 1 is the *semantic* first
    offer, so if the two ever disagree the rank numbering is broken and this
    metric should move with it rather than paper over it.

    Both timestamps come from the database clock — `jobs.requested_at` and
    `job_assignments.offered_at` are column defaults, never set by the
    application — so the subtraction is not measuring clock skew between the API
    process and Postgres. That is why `create_assignment_row` deliberately
    leaves `offered_at` to its default.

    p95 on a pilot-sized sample is a weak statistic and is returned anyway, with
    the count beside it so a reader can see how weak. `percentile_cont`
    interpolates, which is the right choice here over `percentile_disc`: these
    are continuous durations, not a set of observed values to pick from.
    """
    sql = f"""
        SELECT
            count(*)                                                   AS offers_measured,
            round(avg(latency_s)::numeric, 3)                          AS mean_s,
            round(min(latency_s)::numeric, 3)                          AS min_s,
            round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_s)::numeric, 3
            )                                                          AS p50_s,
            round(
                percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_s)::numeric, 3
            )                                                          AS p95_s,
            round(max(latency_s)::numeric, 3)                          AS max_s
        FROM (
            SELECT EXTRACT(EPOCH FROM (a.offered_at - j.requested_at)) AS latency_s
            FROM job_assignments a
            JOIN jobs j ON j.id = a.job_id
            WHERE a.assignment_rank = 1
              AND a.offered_at IS NOT NULL
              AND {_WINDOW}
        ) measured
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


# ---------------------------------------------------------------------------
# Offer outcomes
# ---------------------------------------------------------------------------
async def offer_outcomes(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """Every offer in the window, classified by what the partner did.

    The three outcomes are mutually exclusive and exhaust the table, which is
    asserted in the live harness rather than assumed here: accepted + declined +
    unanswered must equal offers_total.

    `unanswered` is reported separately rather than folded into the denominator
    of one acceptance rate, because there is no offer-expiry mechanism in the
    system (deliberately deferred). An unanswered offer is therefore not a
    refusal — it is an offer that is still open, and will be open forever. A
    single rate over all offers would read as "partners decline this often" when
    the truth is "nobody has answered yet", so the service reports two rates and
    names the difference.
    """
    sql = f"""
        SELECT
            count(*)                                                AS offers_total,
            count(DISTINCT a.job_id)                                AS jobs_offered,
            count(DISTINCT a.partner_id)                            AS partners_offered,
            count(*) FILTER (WHERE a.accepted_at IS NOT NULL)       AS accepted,
            count(*) FILTER (
                WHERE a.responded_at IS NOT NULL AND a.accepted_at IS NULL
            )                                                       AS declined,
            count(*) FILTER (WHERE a.responded_at IS NULL)          AS unanswered,
            count(*) FILTER (
                WHERE a.estimated_arrival_min IS NOT NULL
            )                                                       AS with_eta_estimate
        FROM job_assignments a
        JOIN jobs j ON j.id = a.job_id
        WHERE {_WINDOW}
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


async def offers_before_acceptance(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """How far down the ranked list dispatch had to go before someone accepted.

    The mean of `assignment_rank` over accepted offers, plus the distribution,
    because the mean alone hides the shape: "1.4" is a very different system
    depending on whether it is a few jobs needing six offers or a third of jobs
    needing two.

    Only accepted offers have a rank worth averaging. A job that was offered
    three times and never answered contributes nothing here, and is visible in
    `offer_outcomes.unanswered` instead.
    """
    sql = f"""
        SELECT
            count(*)                                                AS accepted_offers,
            round(avg(a.assignment_rank)::numeric, 3)               AS mean_rank,
            count(*) FILTER (WHERE a.assignment_rank = 1)           AS at_rank_1,
            count(*) FILTER (WHERE a.assignment_rank = 2)           AS at_rank_2,
            count(*) FILTER (WHERE a.assignment_rank >= 3)          AS at_rank_3_or_worse,
            max(a.assignment_rank)                                  AS worst_rank
        FROM job_assignments a
        JOIN jobs j ON j.id = a.job_id
        WHERE a.accepted_at IS NOT NULL
          AND a.assignment_rank IS NOT NULL
          AND {_WINDOW}
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


# ---------------------------------------------------------------------------
# Matching strategy: the comparison the project exists to make
# ---------------------------------------------------------------------------
async def strategy_comparison(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """Divergence rate, and acceptance split by whether the pick was the nearest.

    **Restricted to `assignment_rank = 1`, and that restriction is the whole
    correctness of this metric.** `was_baseline_choice` on a rank-2 offer means
    "this partner was also the nearest of those still eligible after the rank-1
    partner declined" — a different question, asked of a different candidate set.
    Mixing ranks would compare the weighted strategy against a baseline that
    changes definition partway through the sample, and the resulting number would
    not be the divergence rate of anything.

    One row, both arms, so the two rates are computed over the same window in
    the same statement and cannot drift apart through two round trips.
    """
    sql = f"""
        SELECT
            count(*)                                                AS first_offers,
            count(*) FILTER (WHERE a.was_baseline_choice)            AS agreed_with_nearest,
            count(*) FILTER (WHERE NOT a.was_baseline_choice)        AS diverged,
            count(*) FILTER (
                WHERE a.was_baseline_choice AND a.accepted_at IS NOT NULL
            )                                                       AS agreed_accepted,
            count(*) FILTER (
                WHERE a.was_baseline_choice AND a.responded_at IS NOT NULL
            )                                                       AS agreed_answered,
            count(*) FILTER (
                WHERE NOT a.was_baseline_choice AND a.accepted_at IS NOT NULL
            )                                                       AS diverged_accepted,
            count(*) FILTER (
                WHERE NOT a.was_baseline_choice AND a.responded_at IS NOT NULL
            )                                                       AS diverged_answered
        FROM job_assignments a
        JOIN jobs j ON j.id = a.job_id
        WHERE a.assignment_rank = 1
          AND a.was_baseline_choice IS NOT NULL
          AND {_WINDOW}
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


async def component_means(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """Mean of each stored score component, for diverged and agreed picks apart.

    The input to component attribution. The question is which term paid for
    overriding distance, and the shape of the answer is a difference of means
    between the two groups: a diverged pick is by definition worse on distance
    than the nearest partner was, so whichever other term is systematically
    higher on diverged picks is the term that bought the override.

    The keys are read out of the `score_components` JSONB with `->>` and cast,
    rather than being recomputed from the partner's current state. That is the
    entire reason the column exists: `rating_avg`, `active_job_count` and the
    partner's location have all moved since, so recomputing would score a
    different world than the one the decision was made in.

    `stddev_samp` of each component is reported by `component_spread` below,
    because a component with no spread cannot have discriminated between
    candidates whatever its level. That is not hypothetical here: `skill_score`
    is the constant 1.0 by construction — skill is a hard filter, not a weight
    (ADR-009) — and `rating_score` was equally constant for every decision made
    before any partner had been rated, because an unrated partner scores the
    fixed `UNRATED_PARTNER_RATING_SCORE`. Measuring the spread is how that gets
    established per window instead of being asserted from a date in a changelog.
    """
    sql = f"""
        SELECT
            a.was_baseline_choice                                   AS agreed_with_nearest,
            count(*)                                                AS offers,
            round(avg((a.score_components->>'distance_score')::numeric), 4) AS distance_score,
            round(avg((a.score_components->>'load_score')::numeric), 4)     AS load_score,
            round(avg((a.score_components->>'skill_score')::numeric), 4)    AS skill_score,
            round(avg((a.score_components->>'rating_score')::numeric), 4)   AS rating_score,
            round(avg(a.matching_score), 4)                         AS matching_score
        FROM job_assignments a
        JOIN jobs j ON j.id = a.job_id
        WHERE a.assignment_rank = 1
          AND a.was_baseline_choice IS NOT NULL
          AND a.score_components IS NOT NULL
          AND {_WINDOW}
        GROUP BY a.was_baseline_choice
    """
    result = await db.execute(text(sql), _bind(from_ts, to_ts))
    rows = [dict(row) for row in result.mappings().all()]
    # GROUP BY returns no row for an empty arm, and both arms are empty on a
    # window with no dispatches at all. Normalised to a two-key dict here so the
    # service never branches on how many groups came back.
    return {
        "agreed": next(
            (row for row in rows if row["agreed_with_nearest"] is True), None
        ),
        "diverged": next(
            (row for row in rows if row["agreed_with_nearest"] is False), None
        ),
    }


async def component_spread(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """How much each score component varied across the window's first offers.

    This is the query that decides which components are even *eligible* to have
    driven a choice, and it exists so that eligibility is measured rather than
    assumed. A component with zero spread took the same value for every decision
    in the window, so it cannot have separated one candidate from another — its
    weight was spent on a constant.

    Two components can be in that state, for different reasons:

      * `skill_score` always is. Skill is a hard filter applied before scoring
        (ADR-009), so every candidate that reaches the ranking matches, and the
        term is the constant 1.0. Its 0.2 weight is a fixed offset on every
        score, which cancels in every comparison.
      * `rating_score` was, for every dispatch made before partners had ratings:
        an unrated partner scores `UNRATED_PARTNER_RATING_SCORE`, so with nobody
        rated the whole field scored the same. Whether that is true of a given
        window is a fact about the data, not about the code, which is why it is
        read off `stddev_samp` here and not off a release date.

    `stddev_samp` is NULL for a single row, which is correct and is passed
    through as NULL rather than coerced to 0 — one offer says nothing about
    spread, and reporting 0.0 would claim it said "constant".
    """
    sql = f"""
        SELECT
            count(*)                                                 AS offers,
            round(stddev_samp(
                (a.score_components->>'distance_score')::numeric
            ), 6)                                                    AS distance_score,
            round(stddev_samp(
                (a.score_components->>'load_score')::numeric
            ), 6)                                                    AS load_score,
            round(stddev_samp(
                (a.score_components->>'skill_score')::numeric
            ), 6)                                                    AS skill_score,
            round(stddev_samp(
                (a.score_components->>'rating_score')::numeric
            ), 6)                                                    AS rating_score
        FROM job_assignments a
        JOIN jobs j ON j.id = a.job_id
        WHERE a.assignment_rank = 1
          AND a.score_components IS NOT NULL
          AND {_WINDOW}
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


# ---------------------------------------------------------------------------
# Arrival
# ---------------------------------------------------------------------------
async def arrival_times(
    db: AsyncSession,
    *,
    from_ts: Optional[datetime] = None,
    to_ts: Optional[datetime] = None,
) -> dict[str, Any]:
    """Minutes from a partner accepting to work starting on site.

    There is no `arrived` status and no arrival timestamp, so this is the closest
    observable: the `job_status_history` row where the job became 'in_progress',
    which is the transition out of 'partner_en_route'. It therefore measures
    accept -> work started, which includes however long the mechanic spent
    between pulling up and starting. It is named `work_started` rather than
    `arrival` everywhere it surfaces, because calling it arrival would be a claim
    the data does not support.

    `min(changed_at)` rather than the bare join: 'in_progress' is reachable once
    per job under ALLOWED_TRANSITIONS, so there should only ever be one row, and
    taking the earliest means a future transition that re-entered the status
    would not multiply the sample instead of being noticed.
    """
    sql = f"""
        SELECT
            count(*)                                                 AS jobs_measured,
            round(avg(minutes)::numeric, 2)                          AS mean_min,
            round(min(minutes)::numeric, 2)                          AS min_min,
            round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)::numeric, 2
            )                                                        AS p50_min,
            round(
                percentile_cont(0.95) WITHIN GROUP (ORDER BY minutes)::numeric, 2
            )                                                        AS p95_min,
            round(max(minutes)::numeric, 2)                          AS max_min
        FROM (
            SELECT
                EXTRACT(EPOCH FROM (started.changed_at - a.accepted_at)) / 60.0
                    AS minutes
            FROM job_assignments a
            JOIN jobs j ON j.id = a.job_id
            JOIN (
                SELECT job_id, min(changed_at) AS changed_at
                FROM job_status_history
                WHERE status = 'in_progress'
                GROUP BY job_id
            ) started ON started.job_id = j.id
            WHERE a.accepted_at IS NOT NULL
              AND {_WINDOW}
        ) measured
    """
    return await _one(db, sql, _bind(from_ts, to_ts))


# ---------------------------------------------------------------------------
# Partner supply
# ---------------------------------------------------------------------------
async def partner_supply(db: AsyncSession) -> dict[str, Any]:
    """Partner counts as they stand now. Deliberately not windowed.

    `partners` carries no history — `is_available` is a current flag and
    `rating_avg` is a running aggregate — so there is no honest way to report
    what the roster looked like during a past window. Reporting today's roster
    against a window's jobs would invite exactly that misreading, so this is
    returned as its own block, with no window applied and nothing in it
    pretending to be historical.

    `active_job_count` is not read from a column here, because there is no such
    column: it is computed live from job_assignments against jobs.status
    (principle 1), which is the same definition the dispatcher's capacity check
    uses.

    Verification is read from `verification_status = 'verified'`. There is no
    `is_verified` boolean on this table — the column is a four-value enum
    ('pending', 'verified', 'rejected', 'suspended'), and 'rejected' and
    'suspended' are both not-verified without being pending, which a boolean
    could not have carried.
    """
    sql = """
        SELECT
            count(*)                                                 AS partners_total,
            count(*) FILTER (
                WHERE p.verification_status = 'verified'
            )                                                        AS verified,
            count(*) FILTER (WHERE p.is_available)                   AS available_now,
            count(*) FILTER (
                WHERE p.verification_status = 'verified' AND p.is_available
            )                                                        AS dispatchable_now,
            count(*) FILTER (WHERE p.rating_count > 0)               AS rated,
            round(avg(p.rating_avg) FILTER (WHERE p.rating_count > 0), 3)
                                                                     AS mean_rating,
            COALESCE(sum(p.rating_count), 0)                         AS ratings_total
        FROM partners p
    """
    return await _one(db, sql, {})


async def busy_partner_count(db: AsyncSession) -> dict[str, Any]:
    """How many partners are holding at least one live job right now.

    Separate query rather than a column on the one above, because "live job"
    means a join to job_assignments and jobs that the roster counts do not need,
    and folding it in would make every partner row carry the cost.

    The definition of live matches the dispatcher's: an accepted assignment on a
    job that has not reached a terminal status. `accepted_at IS NOT NULL` again,
    not `status = 'accepted'`.
    """
    sql = """
        SELECT
            count(DISTINCT a.partner_id)                             AS partners_busy,
            count(*)                                                 AS live_assignments
        FROM job_assignments a
        JOIN jobs j ON j.id = a.job_id
        WHERE a.accepted_at IS NOT NULL
          AND j.status IN ('assigned', 'partner_en_route', 'in_progress')
    """
    return await _one(db, sql, {})


async def job_count_for_partner(db: AsyncSession, partner_id: uuid.UUID) -> int:
    """Offers ever extended to one partner. Used only by the live harness's
    cleanup assertions; no endpoint reads it."""
    result = await db.execute(
        text(
            "SELECT count(*) AS n FROM job_assignments WHERE partner_id = :pid"
        ),
        {"pid": partner_id},
    )
    return int(result.mappings().one()["n"])
