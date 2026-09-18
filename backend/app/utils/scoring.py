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

# What an unrated partner's rating_score is worth.
#
# 0.6 rather than 0.0. A brand-new partner has no evidence against them, and
# scoring absence of evidence as a zero would bury every new joiner beneath
# anyone holding a single one-star review — which is both unfair and
# self-defeating, since a partner who is never dispatched can never earn a
# rating. 0.6 is deliberately below the average of an actually-good partner
# (4.5/5 = 0.9) and above a bad one, so proven quality still wins while a new
# joiner stays reachable.
UNRATED_PARTNER_RATING_SCORE: float = 0.6

# The rating scale ratings are recorded on, used to normalize to [0, 1].
MAX_RATING: float = 5.0

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
    not a rule. A partner on two jobs is a worse choice than an idle one and
    still a better choice than nobody, which is what dispatch must answer at
    3 a.m. when the idle ones are all 9 km away. A hard eligibility ceiling, if
    one is ever wanted, belongs in the candidate filter where it can be
    explained — not smuggled in as a score of zero.
    """
    return 1.0 / (1.0 + max(active_job_count, 0))


def skill_score() -> float:
    """1.0 for every candidate. See SKILL_SCORE_EXACT_MATCH for why it exists."""
    return SKILL_SCORE_EXACT_MATCH


def rating_score(rating_avg: Optional[float], rating_count: int) -> float:
    """The partner's average rating on a 0–1 scale, or the neutral default.

    An unrated partner (rating_count == 0) gets UNRATED_PARTNER_RATING_SCORE
    rather than rating_avg / 5, because rating_avg for those rows is 0.0 — a
    default, not a judgement. Reading it as a score would treat "nobody has
    rated them" and "everybody rated them one star" as the same fact.
    """
    if rating_count <= 0 or rating_avg is None:
        return UNRATED_PARTNER_RATING_SCORE
    return max(0.0, min(float(rating_avg) / MAX_RATING, 1.0))


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
