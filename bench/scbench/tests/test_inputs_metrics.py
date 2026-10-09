import math
import tempfile
import unittest
from pathlib import Path

from analysis.inputs import StagesNotFoundError, _parse_files, load_arm
from analysis.metrics import is_test_path, recompute_erosion, recompute_verbosity, summarise

from .fixtures import evaluation, source_file, stage, stages_json, write_checkpoint

HERE = Path(__file__).parent


class ArmFixture(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


class SolveDerivationTests(ArmFixture):
    def test_failing_regression_keeps_iso_and_core_but_loses_strict(self):
        write_checkpoint(self.root, "p", 2, evaluation(2, failing=("regression",)))

        result = load_arm(self.root)[("p", 2)]

        self.assertEqual((result.strict, result.iso, result.core), (False, True, True))

    def test_first_checkpoint_without_regression_group_can_be_strict(self):
        write_checkpoint(self.root, "p", 1, evaluation(1))

        self.assertTrue(load_arm(self.root)[("p", 1)].strict)

    def test_failing_functionality_loses_iso_but_not_core(self):
        write_checkpoint(self.root, "p", 1, evaluation(1, failing=("functionality",)))

        result = load_arm(self.root)[("p", 1)]

        self.assertEqual((result.strict, result.iso, result.core), (False, False, True))

    def test_missing_quality_block_leaves_quality_unknown_but_counts_the_checkpoint(self):
        write_checkpoint(self.root, "p", 1, evaluation(1))

        summary = summarise(load_arm(self.root), expected=2, tests_dirs=("tests",))

        self.assertEqual((summary.ran, summary.expected, summary.erosion), (1, 2, None))

    def test_stage_costs_add_to_the_solve_cost(self):
        stages = stages_json(stage("triage", usd=0.25), stage("remediation", usd=0.5))
        write_checkpoint(self.root, "p", 1, evaluation(1, cost=1.0), stages)

        summary = summarise(load_arm(self.root, require_stages=True), expected=1, tests_dirs=("tests",))

        self.assertAlmostEqual(summary.usd_per_checkpoint, 1.75)

    def test_directories_that_are_not_checkpoints_are_ignored(self):
        write_checkpoint(self.root, "p", 1, evaluation(1))
        (self.root / "p" / "logs").mkdir()

        self.assertEqual(list(load_arm(self.root)), [("p", 1)])


class StageLocationTests(ArmFixture):
    def test_stages_json_is_read_from_the_agent_artifacts_dir(self):
        write_checkpoint(self.root, "p", 1, evaluation(1), stages_json(stage("audit", items_out=7)))

        log = load_arm(self.root, require_stages=True)[("p", 1)].stage_log

        self.assertEqual(log.stages[0].items_out, 7)

    def test_stages_json_is_read_from_the_compressed_artifacts(self):
        stages = stages_json(stage("audit", items_out=7), mcp_tool_calls=2)
        write_checkpoint(self.root, "p", 1, evaluation(1), stages, compress=True)

        log = load_arm(self.root, require_stages=True)[("p", 1)].stage_log

        self.assertEqual((log.stages[0].items_out, log.mcp_tool_calls), (7, 2))

    def test_a1_checkpoint_without_stages_json_raises_a_clear_error(self):
        write_checkpoint(self.root, "p", 1, evaluation(1))

        with self.assertRaises(StagesNotFoundError) as caught:
            load_arm(self.root, require_stages=True)

        self.assertIn("agent/stages.json", str(caught.exception))
        self.assertIn("agent.tar.gz", str(caught.exception))

    def test_arms_without_stages_do_not_look_for_them(self):
        write_checkpoint(self.root, "p", 1, evaluation(1))

        self.assertIsNone(load_arm(self.root)[("p", 1)].stage_log)

    def test_resumed_runs_key_by_the_runner_directory_not_the_agent_counter(self):
        write_checkpoint(self.root, "p", 3, evaluation(3), stages_json(stage("audit"), checkpoint=1))

        self.assertEqual(list(load_arm(self.root, require_stages=True)), [("p", 3)])

    def test_stages_that_never_ran_do_not_count_as_succeeded(self):
        rows = [stage(s, status=s) for s in ("disabled", "missing", "skipped_budget", "failed", "timeout")]
        write_checkpoint(self.root, "p", 1, evaluation(1), stages_json(*rows))

        log = load_arm(self.root, require_stages=True)[("p", 1)].stage_log

        self.assertFalse(any(s.succeeded for s in log.stages))
        self.assertEqual([s.exit for s in log.stages], [None, None, None, 2, None])


class SensitivityTests(ArmFixture):
    def test_tests_excluded_run_drops_only_the_agent_tests(self):
        files = [source_file("src/app.py", high_cc=2, flagged=10), source_file("tests/test_app.py", 12, flagged=60)]
        write_checkpoint(self.root, "p", 1, evaluation(1, files=files))

        summary = summarise(load_arm(self.root), expected=1, tests_dirs=("tests",))

        self.assertGreater(summary.erosion, 0)
        self.assertEqual(summary.erosion_ex_tests, 0)
        self.assertAlmostEqual(summary.verbosity, 0.35)
        self.assertAlmostEqual(summary.verbosity_ex_tests, 0.10)

    def test_parity_gap_is_zero_when_the_recompute_matches_the_official_values(self):
        write_checkpoint(self.root, "p", 1, evaluation(1, files=[source_file("src/a.py", 12)]))

        summary = summarise(load_arm(self.root), expected=1, tests_dirs=("tests",))

        self.assertAlmostEqual(summary.parity_gap, 0.0)


class FormulaTests(unittest.TestCase):
    def test_erosion_is_the_mass_share_above_cc_ten(self):
        files = (load_file(source_file("src/a.py", high_cc=12)),)

        self.assertAlmostEqual(recompute_erosion(files, ()), 48 / (48 + 2 * math.sqrt(4)))

    def test_verbosity_is_capped_at_one(self):
        files = (load_file(source_file("src/a.py", 2, loc=10, flagged=30)),)

        self.assertEqual(recompute_verbosity(files, ()), 1.0)

    def test_test_path_matching_is_by_leading_directory(self):
        cases = {"tests/a.py": True, "./tests/a.py": True, "tests": True,
                 "testsuite/a.py": False, "src/tests_a.py": False}

        for path, expected in cases.items():
            self.assertEqual(is_test_path(path, ("tests",)), expected, path)


def load_file(raw: dict):
    return _parse_files([raw])[0]


if __name__ == "__main__":
    unittest.main()
