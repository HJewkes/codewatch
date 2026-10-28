import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.ar_fixtures import BENCH, write_json, write_scored_run

SCORE = BENCH / "autoresearch" / "score.py"


def run_score(run: Path, *extra: str) -> dict:
    out = subprocess.run([sys.executable, "-I", str(SCORE), str(run), "--case", "train-1", "--repeat", "r1",
                          "--wall-s", "512.4", *extra], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


class ScoredS7RunTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.run = write_scored_run(Path(self._tmp.name) / "run")

    def tearDown(self):
        self._tmp.cleanup()

    def test_recorded_training_run_fails_the_all_gate_with_total_cc_up_from_232_to_236(self):
        result = run_score(self.run)
        self.assertEqual(result["gates"], {"hidden": True, "growth": True, "helpers": False, "tests": True})
        self.assertFalse(all(result["gates"].values()))
        self.assertAlmostEqual(result["metrics"]["cc_total_delta_pct"], 100 * 4 / 232, places=3)
        self.assertEqual({k: v for k, v in result["metrics"].items() if k != "cc_total_delta_pct"},
                         {"single_caller_delta": 2, "helpers_one_site_delta": 5, "cog_max_delta": 26,
                          "accepted_tasks": 4, "src_net": 8})
        self.assertEqual(result["violations"], {"hidden_regressions": 0})
        self.assertEqual((result["usd"], result["wall_s"], result["case"], result["repeat"]), (0.447034, 512.4, "train-1", "r1"))

    def test_result_is_also_written_next_to_the_artifacts_with_its_pin_and_dir(self):
        result = run_score(self.run, "--pin", "abc123")
        self.assertEqual(json.loads((self.run / "ar-result.json").read_text()), result)
        self.assertEqual((result["evaluator_pin"], result["artifact_dir"]), ("abc123", str(self.run.resolve())))

    def test_a_hidden_test_newly_failing_counts_as_one_regression(self):
        regrade = json.loads((self.run / "regrade.json").read_text())
        regrade["after"]["hidden"] = {"passed": 199, "total": 216, "failed": regrade["after"]["hidden"]["failed"] + ["hidden/new"]}
        write_json(self.run / "regrade.json", regrade)
        self.assertEqual(run_score(self.run)["violations"], {"hidden_regressions": 1})

    def test_run_with_no_accepted_task_is_a_no_op(self):
        (self.run / "cleanup" / "ledger.jsonl").write_text(json.dumps({"kind": "task", "outcome": "skip"}) + "\n")
        self.assertEqual(run_score(self.run)["metrics"]["accepted_tasks"], 0)


if __name__ == "__main__":
    unittest.main()
