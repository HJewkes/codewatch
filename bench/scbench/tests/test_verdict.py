import unittest
from dataclasses import replace

from analysis.gaming import GamingCheck
from analysis.metrics import ArmSummary
from analysis.paired import Consistency
from analysis.verdict import DecisionInputs, decide, quality_threshold


def arm(strict=5, iso=10, erosion=0.5, verbosity=0.3, usd=1.0, ex=None) -> ArmSummary:
    ex_e, ex_v = ex if ex else (erosion, verbosity)
    return ArmSummary(
        expected=31, ran=31, strict=strict, iso=iso, core=20, erosion=erosion,
        verbosity=verbosity, erosion_ex_tests=ex_e, verbosity_ex_tests=ex_v,
        usd_per_checkpoint=usd, parity_gap=0.0,
    )


LOWER_EVERYWHERE = Consistency(lower=5, higher=1, compared=6, problems=6, needed=4)
MIXED = Consistency(lower=3, higher=3, compared=6, problems=6, needed=4)
CLEAN = GamingCheck(0, 0, 0.1, 0.0, 0.0, True)


def inputs(**overrides) -> DecisionInputs:
    base = DecisionInputs(
        a0=arm(usd=1.0),
        a1a=arm(),
        a1=arm(erosion=0.40, verbosity=0.24, usd=2.0),
        erosion_consistency=LOWER_EVERYWHERE,
        verbosity_consistency=LOWER_EVERYWHERE,
        gaming=CLEAN,
        fire_rate=1.0,
    )
    return replace(base, **overrides)


class DecisionRuleTests(unittest.TestCase):
    def test_both_quality_drops_past_t_with_flat_strict_adopt(self):
        self.assertEqual(decide(inputs()).verdict, "adopt")

    def test_a_strict_gain_of_two_on_top_of_quality_is_a_strong_adopt(self):
        self.assertEqual(decide(inputs(a1=arm(strict=7, erosion=0.4, verbosity=0.24))).verdict, "strong adopt")

    def test_a_cost_ratio_above_two_and_a_half_blocks_adopt(self):
        decision = decide(inputs(a1=arm(erosion=0.4, verbosity=0.24, usd=2.6)))

        self.assertNotIn("adopt", decision.verdict)

    def test_quality_met_but_strict_down_two_iterates(self):
        decision = decide(inputs(a1=arm(strict=3, erosion=0.4, verbosity=0.24)))

        self.assertEqual(decision.verdict, "iterate")
        self.assertTrue(any("ΔS = -2" in r for r in decision.reasons))

    def test_only_erosion_meeting_t_iterates(self):
        decision = decide(inputs(a1=arm(erosion=0.4, verbosity=0.29)))

        self.assertEqual((decision.verdict, decision.reasons), ("iterate", ["only one of ΔE or ΔV met T"]))

    def test_a_drop_that_is_not_consistent_across_problems_does_not_count(self):
        decision = decide(inputs(verbosity_consistency=MIXED))

        self.assertIn("only one of ΔE or ΔV met T", decision.reasons)

    def test_a_failed_gaming_check_iterates(self):
        decision = decide(inputs(gaming=GamingCheck(3, 4, 0.1, 0.08, 0.8, True)))

        self.assertEqual((decision.verdict, decision.reasons), ("iterate", ["gaming check failed"]))

    def test_flat_results_with_stages_firing_drop(self):
        self.assertEqual(decide(inputs(a1=arm(erosion=0.48, verbosity=0.29))).verdict, "drop")

    def test_a_low_fire_rate_blocks_drop_and_iterates(self):
        decision = decide(inputs(a1=arm(erosion=0.48, verbosity=0.29), fire_rate=0.7))

        self.assertEqual(decision.verdict, "iterate")

    def test_strict_down_three_with_no_quality_gain_drops(self):
        decision = decide(inputs(a1=arm(strict=2, erosion=0.6, verbosity=0.3)))

        self.assertEqual(decision.verdict, "drop")

    def test_no_matching_row_is_reported_as_undecided(self):
        self.assertEqual(decide(inputs(a1=arm(erosion=0.44, verbosity=0.27))).verdict, "undecided")


class ThresholdTests(unittest.TestCase):
    def test_threshold_is_fifteen_percent_without_a_replicate(self):
        self.assertEqual(quality_threshold(arm(), None), 0.15)

    def test_threshold_is_twice_a_wide_replicate_spread(self):
        self.assertAlmostEqual(quality_threshold(arm(erosion=0.5), arm(erosion=0.55)), 0.2)

    def test_a_narrow_replicate_spread_keeps_fifteen_percent(self):
        self.assertEqual(quality_threshold(arm(erosion=0.5), arm(erosion=0.51)), 0.15)


if __name__ == "__main__":
    unittest.main()
