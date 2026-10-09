import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

from analysis.inputs import (
    EvalOutputError,
    RerunSettings,
    StagesNotFoundError,
    is_test_path,
    load_arm,
    solve_flags,
)
from analysis.metrics import summarise

from .fixtures import evaluation, fake_scb_check, snapshot, stage, stages_json, write_checkpoint

HERE = Path(__file__).parent


class ArmFixture(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self._tmp.name)
        self.rerun = RerunSettings(("tests",), self.root / "scratch", fake_scb_check)

    def tearDown(self):
        self._tmp.cleanup()

    def arm(self, **kwargs):
        return load_arm(self.root / "arm", **kwargs)

    def write(self, problem, index, raw, **kwargs):
        return write_checkpoint(self.root / "arm", problem, index, raw, **kwargs)


class SolveFlagTests(unittest.TestCase):
    def test_failing_regression_keeps_iso_and_core_but_loses_strict(self):
        self.assertEqual(solve_flags(evaluation(2, failing=("Regression",))), (False, True, True))

    def test_first_checkpoint_without_a_regression_group_can_be_strict(self):
        self.assertEqual(solve_flags(evaluation(1)), (True, True, True))

    def test_failing_functionality_loses_iso_but_not_core(self):
        self.assertEqual(solve_flags(evaluation(1, failing=("Functionality",))), (False, False, True))

    def test_collected_tests_without_counts_are_unsolved(self):
        raw = {"pass_counts": {}, "total_counts": {}, "pytest_collected": 12}

        self.assertEqual(solve_flags(raw), (False, False, False))


class EvalLayoutTests(ArmFixture):
    def test_official_scores_and_cost_come_from_the_run_files(self):
        self.write("p", 1, evaluation(1), scores={"erosion": 0.4, "verbosity": 0.2}, cost=1.5)

        result = self.arm()[("p", 1)]

        self.assertEqual((result.erosion, result.verbosity, result.cost_usd), (0.4, 0.2, 1.5))

    def test_a_failed_scb_check_leaves_quality_unknown_but_counts_the_checkpoint(self):
        self.write("p", 1, evaluation(1), scores={})

        summary = summarise(self.arm(), expected=2)

        self.assertEqual((summary.ran, summary.expected, summary.erosion), (1, 2, None))

    def test_a_run_without_checkpoint_results_raises_a_clear_error(self):
        (self.root / "arm" / "p" / "checkpoint_1").mkdir(parents=True)

        with self.assertRaises(EvalOutputError) as caught:
            self.arm()

        self.assertIn("checkpoint_results.jsonl", str(caught.exception))

    def test_directories_that_are_not_checkpoints_are_ignored(self):
        self.write("p", 1, evaluation(1))
        (self.root / "arm" / "p" / "logs").mkdir()

        self.assertEqual(list(self.arm()), [("p", 1)])

    def test_stage_costs_add_to_the_solve_cost(self):
        stages = stages_json(stage("triage", usd=0.25), stage("remediation", usd=0.5))
        self.write("p", 1, evaluation(1), cost=1.0, stages=stages)

        summary = summarise(self.arm(require_stages=True), expected=1)

        self.assertAlmostEqual(summary.usd_per_checkpoint, 1.75)


class StageLocationTests(ArmFixture):
    def test_stages_json_is_read_from_the_agent_artifacts_dir(self):
        self.write("p", 1, evaluation(1), stages=stages_json(stage("audit", items_out=7)))

        log = self.arm(require_stages=True)[("p", 1)].stage_log

        self.assertEqual(log.stages[0].items_out, 7)

    def test_stages_json_is_read_from_the_compressed_artifacts(self):
        stages = stages_json(stage("audit", items_out=7), mcp_tool_calls=2)
        self.write("p", 1, evaluation(1), stages=stages, compress=True)

        log = self.arm(require_stages=True)[("p", 1)].stage_log

        self.assertEqual((log.stages[0].items_out, log.mcp_tool_calls), (7, 2))

    def test_a1_checkpoint_without_stages_json_raises_a_clear_error(self):
        self.write("p", 1, evaluation(1))

        with self.assertRaises(StagesNotFoundError) as caught:
            self.arm(require_stages=True)

        self.assertIn("agent/stages.json", str(caught.exception))
        self.assertIn("agent.tar.gz", str(caught.exception))

    def test_arms_without_stages_do_not_look_for_them(self):
        self.write("p", 1, evaluation(1))

        self.assertIsNone(self.arm()[("p", 1)].stage_log)

    def test_resumed_runs_key_by_the_runner_directory_not_the_agent_counter(self):
        self.write("p", 3, evaluation(3), stages=stages_json(stage("audit"), checkpoint=1))

        self.assertEqual(list(self.arm(require_stages=True)), [("p", 3)])

    def test_stages_that_never_ran_do_not_count_as_succeeded(self):
        rows = [stage(s, status=s) for s in ("disabled", "missing", "skipped_budget", "failed", "timeout")]
        self.write("p", 1, evaluation(1), stages=stages_json(*rows))

        log = self.arm(require_stages=True)[("p", 1)].stage_log

        self.assertFalse(any(s.succeeded for s in log.stages))
        self.assertEqual([s.exit for s in log.stages], [None, None, None, 2, None])


class SensitivityTests(ArmFixture):
    def test_tests_excluded_rerun_drops_only_the_agent_tests(self):
        self.write("p", 1, evaluation(1), files=snapshot(complex_source=False, flagged_test_lines=4))

        summary = summarise(self.arm(rerun=self.rerun), expected=1)

        self.assertAlmostEqual(summary.verbosity, 4 / 12)
        self.assertEqual(summary.verbosity_ex_tests, 0.0)
        self.assertEqual((summary.erosion, summary.erosion_ex_tests), (0.0, 0.0))

    def test_parity_gap_is_zero_when_the_rerun_reproduces_the_recorded_scores(self):
        self.write("p", 1, evaluation(1), files=snapshot(complex_source=True, flagged_test_lines=2))

        summary = summarise(self.arm(rerun=self.rerun), expected=1)

        self.assertAlmostEqual(summary.parity_gap, 0.0)
        self.assertEqual(summary.erosion_ex_tests, 1.0)

    def test_parity_gap_shows_a_rerun_that_does_not_match_the_grade(self):
        self.write("p", 1, evaluation(1), files=snapshot(False), scores={"erosion": 0.3, "verbosity": 0.0})

        self.assertAlmostEqual(summarise(self.arm(rerun=self.rerun), expected=1).parity_gap, 0.3)

    def test_the_snapshot_itself_is_left_untouched(self):
        directory = self.write("p", 1, evaluation(1), files=snapshot(False, 1))

        self.arm(rerun=self.rerun)

        self.assertTrue((directory / "snapshot" / "tests" / "test_app.py").is_file())

    def test_a_failing_scb_check_leaves_the_sensitivity_unknown(self):
        self.write("p", 1, evaluation(1), files=snapshot(False))
        failing = RerunSettings(("tests",), self.root / "scratch", _raise_called_process_error)

        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            summary = summarise(self.arm(rerun=failing), expected=1)

        self.assertIsNone(summary.erosion_ex_tests)
        self.assertIn("scb-check failed", stderr.getvalue())

    def test_test_path_matching_is_by_leading_directory(self):
        cases = {"tests/a.py": True, "./tests/a.py": True, "tests": True,
                 "testsuite/a.py": False, "src/tests_a.py": False}

        for path, expected in cases.items():
            self.assertEqual(is_test_path(path, ("tests",)), expected, path)


def _raise_called_process_error(path):
    raise subprocess.CalledProcessError(2, ["scb-check"])


if __name__ == "__main__":
    unittest.main()
