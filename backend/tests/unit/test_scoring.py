"""Unit tests for the dispatch scoring module."""
import pytest
from app.utils.scoring import (
    Candidate,
    distance_component,
    load_component,
    skill_component,
    rating_component,
    score,
    rank,
    baseline_pick,
    WEIGHTS,
    R_SEARCH_M,
)


def make_candidate(**kwargs) -> Candidate:
    defaults = dict(
        partner_id="p1",
        distance_m=1000.0,
        active_jobs=0,
        completed_for_service=5,
        rating_avg=4.0,
        rating_count=10,
    )
    defaults.update(kwargs)
    return Candidate(**defaults)


class TestWeights:
    def test_weights_sum_to_one(self):
        assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


class TestDistanceComponent:
    def test_zero_distance_returns_one(self):
        assert distance_component(0) == 1.0

    def test_at_radius_returns_zero(self):
        assert distance_component(R_SEARCH_M) == 0.0

    def test_halfway_returns_half(self):
        assert abs(distance_component(R_SEARCH_M / 2) - 0.5) < 1e-9

    def test_beyond_radius_clamps_to_zero(self):
        assert distance_component(R_SEARCH_M * 2) == 0.0

    def test_within_bounds(self):
        for d in [100, 1000, 3000, 5000, 7000]:
            assert 0.0 <= distance_component(d) <= 1.0


class TestLoadComponent:
    def test_idle_partner_returns_one(self):
        assert load_component(0) == 1.0

    def test_one_active_job_returns_half(self):
        assert abs(load_component(1) - 0.5) < 1e-9

    def test_never_zero_or_negative(self):
        for n in [0, 1, 2, 5, 10]:
            assert load_component(n) > 0.0


class TestSkillComponent:
    def test_no_experience_floors_at_half(self):
        assert skill_component(0) == 0.5

    def test_full_experience_returns_one(self):
        assert skill_component(10, target=10) == 1.0

    def test_within_bounds(self):
        for c in [0, 3, 7, 10, 20]:
            assert 0.0 <= skill_component(c) <= 1.0


class TestRatingComponent:
    def test_smoothed_toward_prior(self):
        # A single perfect review should not be 1.0 after smoothing
        r = rating_component(5.0, 1)
        assert r < 1.0

    def test_unrated_partner_near_prior(self):
        # Prior mean is 3.5/5 = 0.7
        r = rating_component(0.0, 0)
        assert abs(r - 0.7) < 0.01

    def test_within_bounds(self):
        assert 0.0 <= rating_component(4.5, 30) <= 1.0


class TestRank:
    def test_deterministic_ordering(self):
        candidates = [
            make_candidate(partner_id="p3", distance_m=2000),
            make_candidate(partner_id="p1", distance_m=1000),
            make_candidate(partner_id="p2", distance_m=1500),
        ]
        result1 = [t[2].partner_id for t in rank(candidates)]
        result2 = [t[2].partner_id for t in rank(list(reversed(candidates)))]
        assert result1 == result2


class TestBaselinePick:
    def test_picks_nearest(self):
        candidates = [
            make_candidate(partner_id="far", distance_m=5000),
            make_candidate(partner_id="near", distance_m=500),
        ]
        assert baseline_pick(candidates) == "near"

    def test_empty_returns_none(self):
        assert baseline_pick([]) is None
