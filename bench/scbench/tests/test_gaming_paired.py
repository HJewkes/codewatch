import unittest

from analysis.gaming import fire_rate, gaming_check, mechanism_signals
from analysis.inputs import AddedSymbol, CheckpointResult, Stage, StageLog
from analysis.paired import consistency, final_rows, paired_rows

from .test_verdict import arm


def result(problem="p", index=1, strict=False, erosion=None, stages=None) -> CheckpointResult:
    return CheckpointResult(
        problem=problem, index=index, strict=strict, iso=strict, core=strict, cost_usd=1.0,
        erosion=erosion, verbosity=None, files=None, stage_log=stages,
    )


def remediation(outcome="kept", flags=("single-caller-helper",), fixed=0) -> Stage:
    symbols = (AddedSymbol("src/a.py", "_helper", tuple(flags)),)
    return Stage("remediation", 0, 0.3, 4, 3, outcome, fixed, symbols)


def log(*stages: Stage, mcp=0) -> StageLog:
    return StageLog(stages=stages, mcp_tool_calls=mcp)


def arms_with(a1: dict, a1a: dict, a0: dict | None = None) -> dict:
    return {"A0": a0 or {}, "A1a": a1a, "A1": a1}


class PairingTests(unittest.TestCase):
    def test_a_checkpoint_missing_from_one_arm_counts_as_unsolved_there(self):
        rows = paired_rows(arms_with(a1={("p", 1): result(strict=True)}, a1a={}))

        self.assertEqual(rows[0].delta("A1", "A1a", "strict"), 1)
        self.assertIsNone(rows[0].delta("A1", "A1a", "erosion"))

    def test_finals_take_each_problems_highest_checkpoint(self):
        a1 = {(p, i): result(p, i) for p in ("p", "q") for i in (1, 2, 3)}

        finals = final_rows(paired_rows(arms_with(a1=a1, a1a={})))

        self.assertEqual([(r.problem, r.index) for r in finals], [("p", 3), ("q", 3)])

    def test_consistency_needs_four_of_six_problems(self):
        problems = "abcdef"
        a1 = {(p, 1): result(p, erosion=0.3 if p in "abcd" else 0.6) for p in problems}
        a1a = {(p, 1): result(p, erosion=0.5) for p in problems}

        c = consistency(final_rows(paired_rows(arms_with(a1, a1a))), "erosion")

        self.assertEqual((c.lower, c.higher, c.needed, c.consistently_lower), (4, 2, 4, True))


class GamingTests(unittest.TestCase):
    def test_most_of_the_drop_at_kept_split_checkpoints_fails_the_check(self):
        a1 = {("p", 1): result(erosion=0.3, stages=log(remediation())), ("p", 2): result(index=2, erosion=0.4)}
        a1a = {("p", 1): result(erosion=0.5), ("p", 2): result(index=2, erosion=0.5)}

        check = gaming_check(paired_rows(arms_with(a1, a1a)), arm(), arm(erosion=0.35))

        self.assertAlmostEqual(check.split_share, 2 / 3)
        self.assertFalse(check.clean)

    def test_discarded_or_unflagged_remediation_is_not_a_split(self):
        a1 = {("p", 1): result(erosion=0.3, stages=log(remediation("discarded"))),
              ("p", 2): result(index=2, erosion=0.3, stages=log(remediation(flags=())))}
        a1a = {("p", 1): result(erosion=0.5), ("p", 2): result(index=2, erosion=0.5)}

        check = gaming_check(paired_rows(arms_with(a1, a1a)), arm(), arm(erosion=0.3))

        self.assertEqual((check.split_symbols, check.split_share), (0, 0.0))
        self.assertTrue(check.clean)

    def test_a_tests_excluded_run_pointing_the_other_way_fails_the_check(self):
        check = gaming_check([], arm(), arm(erosion=0.4, ex=(0.6, 0.3)))

        self.assertFalse(check.sensitivity_agrees)
        self.assertFalse(check.clean)


class MechanismTests(unittest.TestCase):
    def test_signals_count_kept_fixes_and_strict_gains_they_explain(self):
        stages = log(Stage("audit", 0, 0.0, 0, 10, None, 0, ()), Stage("triage", 0, 0.4, 5, 2, None, 0, ()),
                     Stage("replay", 0, 0.0, 0, 3, None, 0, ()), remediation(fixed=2), mcp=4)
        a1 = {("p", 1): result(strict=True, stages=stages), ("p", 2): result(index=2)}

        rows = paired_rows(arms_with(a1, a1a={("p", 1): result()}))
        signals = mechanism_signals(rows)

        self.assertEqual(signals["findings_per_checkpoint"], 10)
        self.assertEqual(signals["confirmed_share"], 0.4)
        self.assertEqual((signals["replay_diffs_caught"], signals["replay_diffs_fixed"]), (3, 2))
        self.assertEqual((signals["net_fix_checkpoints"], signals["net_fix_strict_gains"]), (1, 1))
        self.assertEqual(signals["mcp_tool_calls"], 4)
        self.assertEqual(fire_rate(rows), 0.5)


if __name__ == "__main__":
    unittest.main()
