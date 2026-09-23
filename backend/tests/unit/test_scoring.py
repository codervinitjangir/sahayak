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
    PRIOR_MEAN,
    PRIOR_WEIGHT,
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
    def test_a_well_reviewed_five_star_partner_approaches_but_never_reaches_one(self):
        """Smoothing is asymptotic, and that is the point.

        A perfect score would mean "no further evidence could change our mind",
        which is never true of a rating. What must hold is that more evidence
        moves it closer.
        """
        assert 0.9 < rating_score(5.0, 50) < 1.0

    def test_more_reviews_move_the_score_toward_the_observed_average(self):
        """The property the whole prior exists to produce.

        One five-star review is weak evidence and scores near the prior; fifty
        is strong evidence and scores near the truth. Without this, a partner
        with a single review outranks one who earned 4.7 over a year — the
        specific failure that made the naive rating_avg / 5 unusable.
        """
        ladder = [rating_score(5.0, n) for n in (1, 5, 20, 100)]
        assert ladder == sorted(ladder)
        assert ladder[0] < 0.8, "one review should not look like a proven partner"
        assert ladder[-1] > 0.95, "a hundred reviews should count as proven"

    def test_one_bad_review_does_not_bury_a_new_partner(self):
        """The same protection running the other way.

        A partner nobody dispatches never earns a second rating, so a single
        one-star review must not be able to end their time on the platform
        before it starts. They should score below the prior — it *is* evidence —
        but nowhere near the floor.
        """
        after_one_bad = rating_score(1.0, 1)
        assert after_one_bad < UNRATED_PARTNER_RATING_SCORE
        assert after_one_bad > 0.5

    def test_unrated_partner_lands_exactly_on_the_prior(self):
        """rating_avg is 0.0 by column default for a partner nobody has rated.

        Reading that as a score would treat "nobody has rated them" and
        "everybody rated them one star" as the same fact. The prior keeps them
        apart with no special case — this is the same formula, with zero
        observations in it.
        """
        assert rating_score(0.0, 0) == pytest.approx(UNRATED_PARTNER_RATING_SCORE)
        assert UNRATED_PARTNER_RATING_SCORE == pytest.approx(PRIOR_MEAN / 5.0)

    def test_null_rating_is_no_evidence_not_zero_stars(self):
        """A row with reviews but no average is inconsistent, not damning.

        Scoring it as zero stars would punish a partner for a data fault, so it
        falls back to the prior exactly as an unrated partner does.
        """
        assert rating_score(None, 5) == pytest.approx(UNRATED_PARTNER_RATING_SCORE)

    def test_prior_sits_between_good_and_bad(self):
        """Why the prior is 3.5 and not 0 or 5.

        A new joiner must stay reachable while a proven good partner still
        outranks them, and a proven bad one still loses to them.
        """
        assert (
            rating_score(1.0, 12)
            < UNRATED_PARTNER_RATING_SCORE
            < rating_score(4.5, 12)
        )

    def test_out_of_range_rating_is_clamped_to_the_scale(self):
        """Clamped before smoothing, so a corrupt row cannot push the posterior
        outside [0, 1] — asserted against the in-range equivalent rather than a
        literal, since the literal changes whenever the prior is re-tuned."""
        assert rating_score(7.0, 3) == pytest.approx(rating_score(5.0, 3))
        assert rating_score(-1.0, 3) == pytest.approx(rating_score(0.0, 3))

    def test_the_prior_is_worth_exactly_prior_weight_reviews(self):
        """PRIOR_WEIGHT is a count of imaginary reviews, not a fudge factor.

        A partner with exactly PRIOR_WEIGHT real reviews is judged half on their
        own evidence and half on the prior, so their score lands exactly midway
        between the two. That is what makes the constant arguable — "how many
        reviews before we believe you?" is a question with an answer — rather
        than a number somebody nudged until the ordering looked right.
        """
        observed, count = 5.0, int(PRIOR_WEIGHT)
        midpoint = ((observed + PRIOR_MEAN) / 2) / 5.0
        assert rating_score(observed, count) == pytest.approx(midpoint)

    def test_stays_in_the_unit_interval_across_the_whole_input_space(self):
        for avg in (0.0, 1.0, 2.5, 4.9, 5.0):
            for count in (0, 1, 3, 25, 400):
                value = rating_score(avg, count)
                assert 0.0 <= value <= 1.0, f"rating_score({avg}, {count}) left [0, 1]"


class TestScore:
    def test_total_is_in_unit_interval(self):
        total, _ = score(make_candidate())
        assert 0.0 <= total <= 1.0

    def test_the_best_realistic_candidate_scores_near_but_below_one(self):
        """1.0 is unreachable, on purpose.

        Three components can max out — standing on the pickup point, idle, exact
        skill match — but rating_score is smoothed toward the prior and only
        approaches its ceiling as reviews accumulate. A total of exactly 1.0
        would mean no further evidence could change the ranking, which is never
        true of a partner. What matters is that the ideal candidate is close to
        the top and still below it.
        """
        total, _ = score(
            make_candidate(distance_m=0.0, active_job_count=0, rating_avg=5.0, rating_count=200)
        )
        assert 0.97 < total < 1.0

    def test_no_input_can_push_the_total_outside_the_unit_interval(self):
        """The invariant that makes two stored scores comparable at all."""
        extremes = [
            make_candidate(distance_m=0.0, active_job_count=0, rating_avg=5.0, rating_count=999),
            make_candidate(distance_m=MAX_RADIUS_M * 3, active_job_count=99,
                           rating_avg=0.0, rating_count=999),
            make_candidate(distance_m=-100.0, active_job_count=-5, rating_avg=None, rating_count=0),
        ]
        for candidate in extremes:
            total, _ = score(candidate)
            assert 0.0 <= total <= 1.0

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
        busy = make_candidate(partner_id="a", active_job_count=1)
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
        near partner is 1 km away but already on a job and rated 1.5/5; the far
        partner is 4 km away, idle and rated 4.9/5, both with enough reviews to
        outweigh the prior. Distance alone picks the first; any sane weighting
        picks the second.

        active_job_count stays at 1 deliberately — a partner on 3 jobs would be
        removed by MAX_CONCURRENT_JOBS before scoring ever saw them, so testing
        the weighting against a candidate who could not exist would prove less
        than it appears to.
        """
        near_bad = make_candidate(
            partner_id="near", distance_m=1_000.0, active_job_count=1,
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
            make_candidate(partner_id="a", distance_m=8_000.0, active_job_count=1),
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
