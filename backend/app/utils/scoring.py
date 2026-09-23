"""
Dispatch scoring.

One score per candidate partner, from four bounded components:

    score = W_DISTANCE * distance_score
          + W_LOAD     * load_score
          + W_SKILL    * skill_score
          + W_RATING   * rating_score

Every component is normalized to [0, 1] where higher is better, so the weighted
sum is also in [0, 1] and two scores are comparable across jobs. Bounded is the
important word: the obvious "closeness = 1/distance" diverges as distance
approaches zero, so one partner standing on the pickup point would dominate a
score no matter how loaded or badly rated they were. A term that cannot exceed
its weight cannot silently become the only term that matters.

This module is pure arithmetic — no database, no Redis, no I/O. That is what
makes the weighting testable in isolation and what lets the evaluation report
replay a stored score_components row without standing the service up.

The other dispatch knobs live next to the code that enforces them, because a
constant far from its enforcement is a constant that gets edited without
effect:

    MAX_CONCURRENT_JOBS   app/repositories/dispatch_repository.py  (eligibility)
    MAX_LOCATION_AGE_S    app/services/dispatch_service.py         (freshness)
"""
from dataclasses import dataclass
from typing import Optional

# Dispatch search radius. Every candidate comes from a GEOSEARCH of this size,
# so it is also the distance at which distance_score reaches zero — the two have
# to be the same number or a candidate could be returned with a negative
# component. dispatch_service imports this rather than declaring its own.
MAX_RADIUS_M: float = 10_000.0

# Weights.
#
# CHOSEN, NOT TUNED. There is no production data yet, so these encode a stated
# opinion rather than a measured optimum: distance matters roughly twice as much
# as anything else (a stranded driver feels minutes, not ratings), and the other
# three are equal because nothing yet justifies ranking them against each other.
#
# They are the first thing to revisit once the pilot produces real outcomes —
# the point of storing score_components per offer is to make that revision an
# analysis rather than a guess. Expect them to change.
W_DISTANCE: float = 0.4
W_LOAD: float = 0.2
W_SKILL: float = 0.2
W_RATING: float = 0.2

WEIGHTS: dict[str, float] = {
    "distance_score": W_DISTANCE,
    "load_score": W_LOAD,
    "skill_score": W_SKILL,
    "rating_score": W_RATING,
}

# Asserted at import rather than trusted. If the weights stop summing to 1 the
# score silently leaves [0, 1] and every stored matching_score before and after
# the change becomes incomparable — a failure that would otherwise show up as a
# puzzling trend in the evaluation report months later.
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "Dispatch weights must sum to 1.0"

# The rating scale ratings are recorded on, used to normalize to [0, 1].
MAX_RATING: float = 5.0

# Bayesian smoothing for ratings: the prior every partner is scored against
# until their own reviews outweigh it.
#
# The naive rating_avg / 5 treats one five-star review as exactly the same
# evidence as fifty of them. That is not a rounding problem, it is a ranking
# problem with a predictable failure: the top of the board fills with partners
# holding a single review, because a perfect 5.0 from one customer beats a 4.7
# earned over a year. It also runs the other way — one bad night gives a new
# partner a 1.0 average they cannot climb out of, since a partner nobody
# dispatches never earns a second rating.
#
# Smoothing fixes both by treating the prior as PRIOR_WEIGHT imaginary reviews
# at PRIOR_MEAN stars:
#
#     smoothed = (rating_avg * rating_count + PRIOR_MEAN * PRIOR_WEIGHT)
#                / (rating_count + PRIOR_WEIGHT)
#
# so evidence has to accumulate before it moves the score. One 5★ review lands
# at 3.75/5, five of them at 4.25, fifty at 4.86 — the score converges on the
# true average at a rate set by how much has actually been observed.
#
# PRIOR_MEAN 3.5 is "unremarkable but fine", deliberately above the midpoint: a
# partner who passed verification is not a coin flip. PRIOR_WEIGHT 5.0 means
# five real reviews are worth as much as the prior — enough to resist a single
# outlier, small enough that a genuinely good partner is not held back for
# months. Both are chosen, not fitted; they are the second thing to revisit
# after the weights once the pilot produces real outcomes.
PRIOR_MEAN: float = 3.5
PRIOR_WEIGHT: float = 5.0

# What an unrated partner's rating_score works out to: 3.5 / 5 = 0.7.
#
# Derived rather than declared, which is the point. An earlier version set this
# to a flat 0.6 as a special case for rating_count == 0, which meant the rule
# for "no reviews" and the rule for "some reviews" were two separate pieces of
# arithmetic that could disagree at the boundary — a partner's score could jump
# the instant their first review landed. With the prior doing the work there is
# no boundary and no special case: an unrated partner simply *is* the prior, and
# every rating after that moves them off it continuously.
#
# It still satisfies what the flat default was for: 0.7 sits below a proven good
# partner and above a bad one, so quality wins while a new joiner stays
# reachable.
UNRATED_PARTNER_RATING_SCORE: float = PRIOR_MEAN / MAX_RATING

# What a candidate who passed the service filter scores on skill.
#
# Always 1.0 today, because find_candidates only returns partners who have the
# job's exact service linked — so by construction every candidate is fully
# skilled and this term contributes W_SKILL to all of them equally, changing no
# ranking. It is kept as an explicit component rather than dropped because the
# filter is expected to relax: once dispatch can fall back to *adjacent* skills
# when nobody has the exact one, this is where "can do it, but it is not their
# speciality" gets expressed. Keeping the field means that change alters one
# function instead of the score's shape, the JSONB key set, and every stored row.
SKILL_SCORE_EXACT_MATCH: float = 1.0


@dataclass(frozen=True)
class Candidate:
    """One partner who passed every eligibility filter, with their score inputs.

    Frozen because scoring must not be able to edit the candidate set it is
    ranking. distance_m comes from Redis, the rest from Postgres; active_job_count
    is counted at read time and never stored (see the derived-data rule in
    dispatch_service).
    """

    partner_id: str
    distance_m: float
    active_job_count: int
    rating_avg: float
    rating_count: int


def distance_score(distance_m: float, max_radius_m: float = MAX_RADIUS_M) -> float:
    """1.0 at the pickup point, falling linearly to 0.0 at the search radius.

    Linear rather than 1/distance: see the module docstring. Clamped at both
    ends so a rounding error in the geo search — or a candidate that arrives
    fractionally outside the radius it was selected by — cannot produce a
    component outside [0, 1].
    """
    if max_radius_m <= 0:
        return 0.0
    return max(0.0, 1.0 - (max(distance_m, 0.0) / max_radius_m))


def load_score(active_job_count: int) -> float:
    """1.0 when idle, 0.5 on one job, 0.33 on two — never zero.

    1 / (1 + n) rather than a hard cap, because "how busy" is a preference and
    not a rule. A partner on one job is a worse choice than an idle one and
    still a better choice than nobody, which is what dispatch must answer at
    3 a.m. when the idle ones are all 9 km away.

    The hard ceiling is a separate thing and lives where it can be explained:
    MAX_CONCURRENT_JOBS in dispatch_repository removes a partner from the
    candidate set entirely once they are at capacity. Expressing that here as a
    score of zero would have hidden a safety rule inside a preference, where a
    future re-weighting could silently overrule it.
    """
    return 1.0 / (1.0 + max(active_job_count, 0))


def skill_score() -> float:
    """1.0 for every candidate. See SKILL_SCORE_EXACT_MATCH for why it exists."""
    return SKILL_SCORE_EXACT_MATCH


def rating_score(rating_avg: Optional[float], rating_count: int) -> float:
    """The partner's rating on a 0–1 scale, smoothed toward the prior.

    Not rating_avg / 5. The raw average answers "how well were they rated",
    which is the wrong question for a ranking — the right one is "how well
    should we expect them to do", and a single review is very weak evidence
    about that. See PRIOR_MEAN / PRIOR_WEIGHT for the arithmetic and why.

    rating_avg is clamped to the recorded scale *before* smoothing, so a
    corrupt row cannot drag the posterior outside [0, 1]. A NULL rating_avg is
    treated as no evidence at all rather than as zero stars, even when
    rating_count claims otherwise: a row with reviews but no average is
    inconsistent, and reading it as "rated zero" would punish a partner for a
    data fault. An unrated partner (rating_count == 0, rating_avg 0.0 by column
    default) falls through the same formula and lands exactly on the prior —
    "nobody has rated them" and "everybody rated them one star" stay different
    facts without needing a branch to keep them apart.
    """
    if rating_avg is None:
        count, observed = 0, 0.0
    else:
        count = max(int(rating_count), 0)
        observed = max(0.0, min(float(rating_avg), MAX_RATING))
    smoothed = ((observed * count) + (PRIOR_MEAN * PRIOR_WEIGHT)) / (count + PRIOR_WEIGHT)
    return max(0.0, min(smoothed / MAX_RATING, 1.0))


def score(candidate: Candidate, max_radius_m: float = MAX_RADIUS_M) -> tuple[float, dict[str, float]]:
    """Return (total, components) for one candidate.

    The components dict is returned alongside the total, not derivable from it,
    and is what gets stored in job_assignments.score_components. Its keys are the
    API-visible contract for that column — renaming one invalidates every row
    already written, so they match the column's documented example exactly.
    """
    components = {
        "distance_score": distance_score(candidate.distance_m, max_radius_m),
        "load_score": load_score(candidate.active_job_count),
        "skill_score": skill_score(),
        "rating_score": rating_score(candidate.rating_avg, candidate.rating_count),
    }
    total = sum(WEIGHTS[key] * value for key, value in components.items())
    return total, components


def rank(
    candidates: list[Candidate], max_radius_m: float = MAX_RADIUS_M
) -> list[tuple[float, dict[str, float], Candidate]]:
    """Score every candidate and sort best first.

    The tie-breakers matter more than they look. Two partners can score
    identically — same distance bucket, both idle, both unrated is not a rare
    case in a small pilot — and a sort that leaves ties in input order makes the
    winner depend on the order Redis happened to return members in. That turns
    an unreproducible bug into a rotating one. So: score descending, then
    nearest, then most-rated, then partner_id, which is unique and therefore
    guarantees a total order.
    """
    scored = []
    for candidate in candidates:
        total, components = score(candidate, max_radius_m)
        scored.append((total, components, candidate))
    scored.sort(
        key=lambda row: (
            -row[0],
            row[2].distance_m,
            -row[2].rating_count,
            str(row[2].partner_id),
        )
    )
    return scored


def baseline_pick(candidates: list[Candidate]) -> Optional[str]:
    """Who a naive nearest-partner-only search would have chosen.

    The control arm. This is deliberately the dumbest possible strategy — sort
    by distance, take the first — because the question it answers is "is the
    weighted engine doing anything a one-line distance sort would not have
    done?". Comparing against a cleverer baseline would flatter the result.

    Returns None for an empty candidate set, which is a real outcome rather than
    an error: the baseline has nobody to pick either.
    """
    if not candidates:
        return None
    nearest = min(candidates, key=lambda c: (c.distance_m, str(c.partner_id)))
    return nearest.partner_id
