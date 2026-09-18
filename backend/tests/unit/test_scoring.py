"""
Unit tests for app/utils/scoring.py.

Pure arithmetic, no database and no Redis — which is the point of keeping the
weighting in its own module. These tests are the cheapest place to catch a
ranking change, and the only place a weight can be re-tuned with evidence rather
than argument.

What is asserted here is mostly *bounds and orderings* rather than exact
numbers. The weights are explicitly provisional (see W_DISTANCE and friends), so
a test that pinned the total score of a given candidate to four decimal places
would fail the first time someone legitimately re-tuned them, and would teach
whoever hit it to update the expected number rather than think. The properties
that must survive re-tuning — every component in [0, 1], nearer beats further,
idle beats busy, a total order under ties — are asserted exactly.
"""
import pytest

from app.utils.scoring import (
    MAX_RADIUS_M,
    UNRATED_PARTNER_RATING_SCORE,
    WEIGHTS,
    Candidate,
    baseline_pick,
    distance_score,
    load_score,
    rank,
    rating_score,
    score,
    skill_score,
)


def make_candidate(
    partner_id: str = "11111111-1111-1111-1111-111111111111",
    distance_m: float = 1000.0,
    active_job_count: int = 0,
    rating_avg: float = 4.5,
    rating_count: int = 10,
) -> Candidate:
    """A candidate with sane defaults, so each test varies only what it is about."""
    return Candidate(
        partner_id=partner_id,
        distance_m=distance_m,
        active_job_count=active_job_count,
        rating_avg=rating_avg,
        rating_count=rating_count,
    )


class TestWeights:
    def test_weights_sum_to_one(self):
        """The invariant the whole score depends on.

        If the weights stop summing to 1 the total silently leaves [0, 1] and
        every score stored before the change becomes incomparable with every
        score after it. The module asserts this at import; this asserts that the
        assert is right.
        """
        assert sum(WEIGHTS.values()) == pytest.approx(1.0)

    def test_weight_keys_match_component_keys(self):
        """WEIGHTS and the component dict must agree, key for key.

        score() looks each component up in WEIGHTS by name. A component added to
        one and not the other is either a KeyError or — worse — a term silently
        dropped from the sum.
        """
        _, components = score(make_candidate())
        assert set(components) == set(WEIGHTS)


class TestDistanceScore:
    def test_at_pickup_point_is_one(self):
        assert distance_score(0.0) == 1.0

    def test_at_search_radius_is_zero(self):
        assert distance_score(MAX_RADIUS_M) == 0.0

    def test_halfway_is_half(self):
        assert distance_score(MAX_RADIUS_M / 2) == pytest.approx(0.5)

    def test_beyond_radius_clamps_to_zero_not_negative(self):
        """A candidate fractionally outside the radius must not score negative.

        Redis selects by radius and this function re-derives the score from the
        distance it returned; rounding between the two is enough to produce a
        distance a hair over the limit. Unclamped, that would be a negative term
        dragging the total below zero.
        """
        assert distance_score(MAX_RADIUS_M * 2) == 0.0

    def test_negative_distance_clamps_to_one(self):
        assert distance_score(-50.0) == 1.0

    def test_is_monotonic_in_distance(self):
        """Nearer is never worse. The one property a re-tuning must not break."""
        distances = [0, 500, 1000, 5000, 9999, 10000]
        scores = [distance_score(d) for d in distances]
        assert scores == sorted(scores, reverse=True)

    def test_does_not_diverge_near_zero(self):
        """Bounded, unlike the obvious 1/distance.

        This is the specific bug the linear form exists to avoid: with 1/d, a
        partner standing on the pickup point scores arbitrarily high and no
        amount of being overloaded or badly rated can outweigh them.
        """
        assert distance_score(0.001) <= 1.0


class TestLoadScore:
    def test_idle_partner_scores_one(self):
        assert load_score(0) == 1.0

    def test_one_active_job_halves_it(self):
        assert load_score(1) == pytest.approx(0.5)

    def test_two_active_jobs(self):
        assert load_score(2) == pytest.approx(1 / 3)

    def test_never_reaches_zero(self):
        """A busy partner is a worse choice than an idle one and a better choice
        than nobody. A hard ceiling, if ever wanted, belongs in the eligibility
        filter where it can be explained — not as a score of zero here."""
        assert load_score(100) > 0.0

    def test_negative_count_treated_as_idle(self):
        assert load_score(-1) == 1.0


class TestSkillScore:
    def test_is_one_for_every_candidate(self):
        """Constant today because find_candidates only returns exact matches.

        Kept as a component so relaxing that filter to adjacent skills changes
        one function rather than the score's shape, the stored JSONB key set,
        and every row already written.
        """
        assert skill_score() == 1.0


class TestRatingScore:
    def test_five_stars_is_one(self):
        assert rating_score(5.0, 20) == 1.0

    def test_normalises_to_the_five_point_scale(self):
        assert rating_score(4.5, 10) == pytest.approx(0.9)

    def test_unrated_partner_gets_the_neutral_default(self):
        """rating_avg is 0.0 by column default for a partner nobody has rated.

        Reading that as a score would treat "nobody has rated them" and
        "everybody rated them one star" as the same fact.
        """
        assert rating_score(0.0, 0) == UNRATED_PARTNER_RATING_SCORE

    def test_null_rating_gets_the_neutral_default(self):
        assert rating_score(None, 5) == UNRATED_PARTNER_RATING_SCORE

    def test_neutral_default_sits_between_good_and_bad(self):
        """The reason the default is 0.6 and not 0.0 or 1.0.

        A new joiner must stay reachable — a partner who is never dispatched can
        never earn a rating — while a proven good partner still outranks them.
        """
        assert rating_score(1.0, 3) < UNRATED_PARTNER_RATING_SCORE < rating_score(4.5, 10)

    def test_out_of_range_rating_is_clamped(self):
        assert rating_score(7.0, 3) == 1.0
        assert rating_score(-1.0, 3) == 0.0


class TestScore:
    def test_total_is_in_unit_interval(self):
        total, _ = score(make_candidate())
        assert 0.0 <= total <= 1.0

    def test_best_possible_candidate_scores_one(self):
        total, _ = score(
            make_candidate(distance_m=0.0, active_job_count=0, rating_avg=5.0, rating_count=9)
        )
        assert total == pytest.approx(1.0)

    def test_every_component_is_in_unit_interval(self):
        _, components = score(
            make_candidate(distance_m=9_999.0, active_job_count=7, rating_avg=1.0, rating_count=2)
        )
        for name, value in components.items():
            assert 0.0 <= value <= 1.0, f"{name} left [0, 1]"

    def test_total_equals_the_weighted_sum_of_its_components(self):
        """The stored score_components must actually explain the stored score.

        This is what makes an offer auditable: if the two can drift, the
        breakdown is decoration rather than evidence.
        """
        total, components = score(make_candidate(distance_m=3_000.0, active_job_count=1))
        expected = sum(WEIGHTS[k] * v for k, v in components.items())
        assert total == pytest.approx(expected)

    def test_component_keys_are_the_documented_contract(self):
        """These key names are written into job_assignments.score_components and
        read back by the evaluation report. Renaming one invalidates every row
        already stored, so the names are pinned here deliberately."""
        _, components = score(make_candidate())
        assert sorted(components) == [
            "distance_score",
            "load_score",
            "rating_score",
            "skill_score",
        ]


class TestRank:
    def test_empty_input_gives_empty_output(self):
        assert rank([]) == []

    def test_sorts_best_first(self):
        far = make_candidate(partner_id="a", distance_m=9_000.0)
        near = make_candidate(partner_id="b", distance_m=500.0)
        ranked = rank([far, near])
        assert [c.partner_id for _, _, c in ranked] == ["b", "a"]

    def test_all_else_equal_the_idle_partner_wins(self):
        busy = make_candidate(partner_id="a", active_job_count=3)
        idle = make_candidate(partner_id="b", active_job_count=0)
        ranked = rank([busy, idle])
        assert ranked[0][2].partner_id == "b"

    def test_all_else_equal_the_better_rated_partner_wins(self):
        poor = make_candidate(partner_id="a", rating_avg=2.0, rating_count=8)
        good = make_candidate(partner_id="b", rating_avg=4.8, rating_count=8)
        ranked = rank([poor, good])
        assert ranked[0][2].partner_id == "b"

    def test_a_closer_but_worse_partner_can_lose_to_a_further_better_one(self):
        """The case that proves the weighting does something at all.

        If this ever fails, the engine has become an expensive distance sort and
        the divergence metric will correctly report zero.

        The numbers are chosen to make the margin real rather than marginal: the
        near partner is 1 km away but juggling three jobs and rated 1.5/5; the
        far partner is 4 km away, idle and rated 4.9/5. Distance alone picks the
        first; any sane weighting picks the second.
        """
        near_bad = make_candidate(
            partner_id="near", distance_m=1_000.0, active_job_count=3,
            rating_avg=1.5, rating_count=12,
        )
        far_good = make_candidate(
            partner_id="far", distance_m=4_000.0, active_job_count=0,
            rating_avg=4.9, rating_count=12,
        )
        ranked = rank([near_bad, far_good])
        assert ranked[0][2].partner_id == "far"
        assert baseline_pick([near_bad, far_good]) == "near"

    def test_ties_are_broken_deterministically_regardless_of_input_order(self):
        """Identical candidates must not rank differently depending on the order
        Redis happened to return them in.

        Without a total-order tie-break this is the worst kind of bug: it does
        not reproduce, it rotates.
        """
        a = make_candidate(partner_id="aaaa")
        b = make_candidate(partner_id="bbbb")
        assert [c.partner_id for _, _, c in rank([a, b])] == [
            c.partner_id for _, _, c in rank([b, a])
        ]

    def test_scores_are_non_increasing_down_the_ranking(self):
        candidates = [
            make_candidate(partner_id="a", distance_m=8_000.0, active_job_count=2),
            make_candidate(partner_id="b", distance_m=200.0),
            make_candidate(partner_id="c", distance_m=4_000.0, rating_avg=3.0),
        ]
        totals = [total for total, _, _ in rank(candidates)]
        assert totals == sorted(totals, reverse=True)


class TestBaselinePick:
    def test_empty_candidate_set_picks_nobody(self):
        """None, not an error: the naive baseline has nobody to pick either."""
        assert baseline_pick([]) is None

    def test_picks_the_nearest_ignoring_everything_else(self):
        """Deliberately the dumbest possible strategy.

        The baseline is the control arm — comparing the engine against a
        cleverer baseline would flatter the result.
        """
        candidates = [
            make_candidate(partner_id="far", distance_m=5_000.0, rating_avg=5.0, rating_count=99),
            make_candidate(partner_id="near", distance_m=300.0, rating_avg=1.0,
                           rating_count=99, active_job_count=9),
        ]
        assert baseline_pick(candidates) == "near"

    def test_is_stable_regardless_of_input_order(self):
        a = make_candidate(partner_id="aaaa", distance_m=1_000.0)
        b = make_candidate(partner_id="bbbb", distance_m=1_000.0)
        assert baseline_pick([a, b]) == baseline_pick([b, a])

    def test_agrees_with_the_ranking_when_the_nearest_is_also_the_best(self):
        """The convergent case. was_baseline_choice is true on rank 1 here, and
        the divergence metric counts this job as agreement."""
        near_good = make_candidate(partner_id="near", distance_m=500.0)
        far_same = make_candidate(partner_id="far", distance_m=6_000.0)
        ranked = rank([near_good, far_same])
        assert ranked[0][2].partner_id == baseline_pick([near_good, far_same])
