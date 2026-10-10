import unittest

from analysis.gaming import fire_rate, gaming_check, mechanism_signals
from analysis.inputs import AddedSymbol, CheckpointResult, FixItem, Stage, StageLog
from analysis.paired import consistency, final_rows, paired_rows

from .test_verdict import arm


def result(problem="p", index=1, strict=False, erosion=None, stages=None) -> CheckpointResult:
    return CheckpointResult(
        problem=problem, index=index, strict=strict, iso=strict, core=strict, cost_usd=1.0,
        erosion=erosion, verbosity=None, rerun=None, stage_log=stages,
    )


def fix_item(status="kept", phase=2, kind="quality", signal="symbol-single-caller-helper", flags=("single-caller-helper",),
             resumed=False, review="ok", missing=None) -> FixItem:
    symbols = (AddedSymbol("src/a.py", "_helper", tuple(flags)),) if flags else ()
    return FixItem(phase, kind, signal, status, resumed, review, missing, symbols)


def remediation(outcome="kept", *items: FixItem, held_back=0) -> Stage:
    return Stage("fix", "ok", 0, 0.3, 4, 3, outcome, items or (fix_item(outcome),), held_back)


def plain(name: str, status="ok", items_in=0, items_out=0, usd=0.0) -> Stage:
    exit_code = {"ok": 0, "failed": 2}.get(status)
    return Stage(name, status, exit_code, usd, items_in, items_out, None)


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
        a1 = {("p", 1): result(erosion=0.3, stages=log(remediation("reverted"))),
              ("p", 2): result(index=2, erosion=0.3, stages=log(remediation("kept", fix_item(flags=()))))}
        a1a = {("p", 1): result(erosion=0.5), ("p", 2): result(index=2, erosion=0.5)}

        check = gaming_check(paired_rows(arms_with(a1, a1a)), arm(), arm(erosion=0.3))

        self.assertEqual((check.split_symbols, check.split_share), (0, 0.0))
        self.assertTrue(check.clean)

    def test_zero_scores_in_both_arms_read_as_no_change_not_unknown(self):
        check = gaming_check([], arm(verbosity=0.3, ex=(0.5, 0.0)), arm(erosion=0.4, verbosity=0.3, ex=(0.4, 0.0)))

        self.assertTrue(check.sensitivity_agrees)

    def test_a_tests_excluded_run_pointing_the_other_way_fails_the_check(self):
        check = gaming_check([], arm(), arm(erosion=0.4, ex=(0.6, 0.3)))

        self.assertFalse(check.sensitivity_agrees)
        self.assertFalse(check.clean)


class MechanismTests(unittest.TestCase):
    def test_signals_count_kept_fixes_and_strict_gains_they_explain(self):
        stages = log(plain("audit", items_out=10), plain("triage", items_in=5, items_out=2, usd=0.4),
                     remediation(), mcp=4)
        a1 = {("p", 1): result(strict=True, stages=stages), ("p", 2): result(index=2)}

        rows = paired_rows(arms_with(a1, a1a={("p", 1): result()}))
        signals = mechanism_signals(rows)

        self.assertEqual(signals["findings_per_checkpoint"], 10)
        self.assertEqual(signals["confirmed_share"], 0.4)
        self.assertNotIn("replay_diffs_caught", signals)
        self.assertEqual((signals["net_fix_checkpoints"], signals["net_fix_strict_gains"]), (1, 1))
        self.assertEqual(signals["mcp_tool_calls"], 4)
        self.assertEqual(fire_rate(rows), 0.5)

    def test_disabled_missing_and_skipped_stages_do_not_fire(self):
        never_ran = log(plain("index", "disabled"), plain("audit", "missing"), plain("triage", "skipped_budget"))
        a1 = {("p", 1): result(stages=never_ran), ("p", 2): result(index=2, stages=log(plain("index")))}

        self.assertEqual(fire_rate(paired_rows(arms_with(a1, a1a={}))), 0.5)

    def test_failed_stages_cost_money_but_their_counts_are_not_signals(self):
        failed = log(plain("audit", "failed", items_out=99, usd=0.2), plain("triage", "timeout", items_out=5))
        rows = paired_rows(arms_with({("p", 1): result(stages=failed)}, a1a={}))

        signals = mechanism_signals(rows)

        self.assertEqual((signals["findings_per_checkpoint"], signals["confirmed_share"]), (0, None))
        self.assertEqual((signals["stage_usd"], signals["stages_failed_or_timed_out"]), (0.2, 2))
        self.assertEqual(fire_rate(rows), 0.0)


if __name__ == "__main__":
    unittest.main()
