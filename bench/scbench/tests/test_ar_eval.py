import json
import os
import subprocess
import tempfile
import unittest
from numbers import Real
from pathlib import Path

from tests.ar_fixtures import BENCH, FIXTURE_ENV, KEPT, LANE_TREES, stub_idea, stub_inputs, stub_pin, write_scored_run

TARGET = json.loads((BENCH / "autoresearch" / "target.json").read_text())


def v2_problems(result: dict, metric: dict) -> list[str]:
    """ar-result/v2 as the engine's ArResultSchema and resultSchemaFor(metric) check it (titan-platform #2074)."""
    def number(v) -> bool:
        return isinstance(v, Real) and not isinstance(v, bool)
    checks = {
        "schema": result.get("schema") == "ar-result/v2",
        "case": isinstance(result.get("case"), str), "repeat": isinstance(result.get("repeat"), str),
        "metrics": isinstance(result.get("metrics"), dict) and all(number(v) for v in result["metrics"].values()),
        "gates": isinstance(result.get("gates", {}), dict) and all(isinstance(v, bool) for v in result.get("gates", {}).values()),
        "violations": all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in result.get("violations", {}).values()),
        "usd": number(result.get("usd")) and result["usd"] >= 0, "wall_s": number(result.get("wall_s")) and result["wall_s"] >= 0,
    }
    problems = [name for name, ok in checks.items() if not ok]
    required = [metric["primary"]["name"], *metric.get("guards", {}), *([metric["noOp"]] if metric.get("noOp") else [])]
    return problems + [f"metrics.{m}" for m in required if m not in (result.get("metrics") or {})]


class StubPinTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.pin, self.idea = stub_pin(root / "pin"), stub_idea(root / "idea")
        self.trace = root / "trace.txt"
        self.env = {**os.environ, **stub_inputs(root, "case-a", "set-a", "prob"), "AR_TRACE": str(self.trace),
                    FIXTURE_ENV: str(write_scored_run(root / "fixture"))}
        self.env.pop("RUNNER_ROOT", None)

    def tearDown(self):
        self._tmp.cleanup()

    def stages(self) -> dict[str, Path]:
        return {stage: Path(path) for stage, path in (line.split(" ", 1) for line in self.trace.read_text().splitlines())}

    def run_s7(self, *flags: str, **env: str) -> Path:
        subprocess.run(["bash", str(self.pin / "c239" / "harness" / "run_s7.sh"), "set-a", "prob", "case-a", "0.5", *flags],
                       env={**self.env, **env}, check=True, capture_output=True)
        return Path(self.env["HOME"]) / ".cache" / "c248-s7" / "runs" / "case-a" / "cleanup"


class RunnerRootTests(StubPinTestCase):
    def test_runner_comes_from_runner_root_while_every_scoring_stage_comes_from_the_pin(self):
        self.run_s7(RUNNER_ROOT=str(self.idea))
        stages = self.stages()
        self.assertTrue(stages.pop("runner").is_relative_to(self.idea))
        self.assertEqual(set(stages), {"measure", "diffgate", "regrade", "gates", "cleanup_report"})
        self.assertTrue(all(path.is_relative_to(self.pin) for path in stages.values()), stages)

    def test_runner_falls_back_to_the_pin_without_runner_root(self):
        self.run_s7()
        self.assertTrue(self.stages()["runner"].is_relative_to(self.pin))


class LaneTreeTests(StubPinTestCase):
    def test_lane_trees_are_pruned_by_default_and_the_attempt_records_stay(self):
        cleanup = self.run_s7()
        self.assertEqual([t for t in LANE_TREES if (cleanup / t).exists()], [])
        self.assertTrue(all((cleanup / t).is_dir() for t in KEPT))

    def test_keep_lanes_keeps_the_lane_trees_but_not_the_visible_test_copies(self):
        cleanup = self.run_s7("--keep-lanes")
        self.assertEqual([t for t in LANE_TREES if (cleanup / t).exists()], LANE_TREES[:3])


class ArEvalTests(StubPinTestCase):
    def ar_eval(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["bash", str(self.pin / "autoresearch" / "ar_eval.sh"), *args],
                              env=self.env, capture_output=True, text=True, check=False)

    def test_output_is_a_v2_result_carrying_the_target_metrics(self):
        done = self.ar_eval("set-a", "case-a", "case-a-r1", "0.5", str(self.idea))
        self.assertEqual(done.returncode, 0, done.stderr)
        result = json.loads(done.stdout)
        self.assertEqual(v2_problems(result, TARGET["metric"]), [])
        self.assertEqual((result["case"], result["repeat"], result["usd"]), ("case-a", "case-a-r1", 0.25))
        self.assertTrue(self.stages()["runner"].is_relative_to(self.idea))

    def test_a_case_from_another_case_set_is_refused_before_any_stage(self):
        done = self.ar_eval("set-b", "case-a", "case-a-r1", "0.5", str(self.idea))
        self.assertEqual(done.returncode, 2)
        self.assertFalse(self.trace.exists())

    def test_shape_check_rejects_a_seed_keyed_result_and_a_missing_guard_metric(self):
        bad = {"schema": "ar-result/v2", "seed": "x", "repeat": "1", "metrics": {"cc_total_delta_pct": 1.0},
               "usd": 0, "wall_s": 1}
        self.assertEqual(v2_problems(bad, TARGET["metric"]), ["case", "metrics.single_caller_delta", "metrics.accepted_tasks"])


if __name__ == "__main__":
    unittest.main()
