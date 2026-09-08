"""
Dispatch scoring utilities.

All components are normalized to [0, 1] where higher is better.
Weights sum to exactly 1.0 — asserted at module load time.
"""
from dataclasses import dataclass

# Configuration defaults — override via environment variables in production
R_SEARCH_M: float = 7000.0        # dispatch search radius (m)
MAX_CONCURRENT_JOBS: int = 2       # hard eligibility gate, not a score input
MAX_LOCATION_AGE_S: int = 120      # stale coordinates are untrustworthy for distance
EXPERIENCE_TARGET: int = 10        # completed jobs of a service for full skill credit
PRIOR_MEAN: float = 3.5            # Bayesian prior for an unrated partner
PRIOR_WEIGHT: float = 5.0          # how many "virtual" ratings the prior is worth

WEIGHTS: dict[str, float] = {
    "distance": 0.45,
    "load": 0.20,
    "skill": 0.20,
    "rating": 0.15,
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "Dispatch weights must sum to 1.0"


@dataclass(frozen=True)
class Candidate:
    partner_id: str
    distance_m: float
    active_jobs: int
    completed_for_service: int
    rating_avg: float
    rating_count: int


def distance_component(distance_m: float, radius_m: float = R_SEARCH_M) -> float:
    """1.0 at the pickup point, decaying linearly to 0.0 at the search radius.
    Bounded — unlike 1/distance, which diverges as distance approaches zero."""
    if distance_m <= 0:
        return 1.0
    return 1.0 - min(distance_m / radius_m, 1.0)


def load_component(active_jobs: int) -> float:
    """1.0 when idle, 0.5 at one active job, 0.33 at two.
    Uses 1/(1+n) so an idle partner (n=0) does not divide by zero."""
    return 1.0 / (1.0 + max(active_jobs, 0))


def skill_component(completed_for_service: int, target: int = EXPERIENCE_TARGET) -> float:
    """Verified capability floors at 0.5; service-specific experience lifts it to 1.0.
    A candidate that failed the service filter never reaches scoring at all."""
    if target <= 0:
        return 1.0
    return 0.5 + 0.5 * min(completed_for_service / target, 1.0)


def rating_component(rating_avg: float, rating_count: int) -> float:
    """Bayesian-smoothed rating mapped to [0,1]. One lucky 5-star cannot outrank
    a long record, and a brand-new partner sits near the prior rather than at zero."""
    smoothed = ((rating_avg * rating_count) + (PRIOR_MEAN * PRIOR_WEIGHT)) / (
        rating_count + PRIOR_WEIGHT
    )
    return max(0.0, min(smoothed / 5.0, 1.0))


def score(c: Candidate) -> tuple[float, dict[str, float]]:
    """Returns (total, components). Components are persisted for explainability."""
    parts = {
        "distance": distance_component(c.distance_m),
        "load": load_component(c.active_jobs),
        "skill": skill_component(c.completed_for_service),
        "rating": rating_component(c.rating_avg, c.rating_count),
    }
    total = sum(WEIGHTS[k] * v for k, v in parts.items())
    return total, parts


def rank(candidates: list[Candidate]) -> list[tuple[float, dict[str, float], Candidate]]:
    """Deterministic total ordering. partner_id breaks any residual tie so that
    seeded test scenarios and baseline comparisons are exactly reproducible."""
    scored = [(score(c)[0], score(c)[1], c) for c in candidates]
    scored.sort(
        key=lambda t: (-t[0], t[2].distance_m, -t[2].rating_count, t[2].partner_id)
    )
    return scored


def baseline_pick(candidates: list[Candidate]) -> str | None:
    """Nearest-only control: what the naive strategy would have chosen."""
    if not candidates:
        return None
    return min(candidates, key=lambda c: (c.distance_m, c.partner_id)).partner_id
