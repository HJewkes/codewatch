import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from analysis.__main__ import main

from .fixtures import RULE_ID, evaluation, fake_scb_check, snapshot, stage, stages_json, write_checkpoint

HERE = Path(__file__).parent
PROBLEMS = ("alpha", "beta", "gamma")


def write_arm(root: Path, complex_source: bool, cost: float, stages=None):
    for problem in PROBLEMS:
        for index in (1, 2):
            files = snapshot(complex_source, flagged_test_lines=2)
            write_checkpoint(root, problem, index, evaluation(index), files=files, cost=cost, stages=stages)


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        root = Path(self._tmp.name)
        self.out = root / "out"
        a1_stages = stages_json(stage("index", "disabled"), stage("audit", items_out=4), stage("triage", usd=0.4))
        write_arm(root / "a0", complex_source=True, cost=1.0)
        write_arm(root / "a1a", complex_source=True, cost=1.1)
        write_arm(root / "a1", complex_source=False, cost=1.2, stages=a1_stages)
        self.argv = ["--a0", str(root / "a0"), "--a1a", str(root / "a1a"), "--a1", str(root / "a1"),
                     "--out", str(self.out), "--scratch", str(root / "scratch")]

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, *extra: str) -> str:
        with contextlib.redirect_stdout(io.StringIO()):
            main([*self.argv, *extra], scb_check=fake_scb_check)
        return (self.out / "report.md").read_text()

    def report_json(self) -> dict:
        return json.loads((self.out / "report.json").read_text())

    def test_report_carries_every_section_six_part(self):
        report = self.run_main()

        for heading in ("## Verdict:", "## Arms", "## Gaming checks", "## Mechanism signals",
                        "## Per-problem final checkpoints", "## Paired per-checkpoint deltas"):
            self.assertIn(heading, report)

    def test_erosion_gone_without_verbosity_change_iterates(self):
        self.run_main()

        data = self.report_json()

        self.assertEqual(data["decision"]["verdict"], "iterate")
        self.assertEqual(data["decision"]["reasons"], ["only one of ΔE or ΔV met T"])
        self.assertEqual(len(data["checkpoints"]), 6)
        self.assertEqual([f["checkpoint"] for f in data["finals"]], [2, 2, 2])
        self.assertEqual(data["fire_rate"], 1.0)
        self.assertEqual(data["summaries"]["A1"]["parity_gap"], 0.0)
        self.assertEqual(data["summaries"]["A1a"]["verbosity_ex_tests"], 0.0)

    def test_skipping_the_sensitivity_run_fails_the_gaming_check(self):
        self.run_main("--skip-sensitivity")

        data = self.report_json()

        self.assertIsNone(data["gaming"]["sensitivity_agrees"])
        self.assertFalse(data["gaming"]["clean"])

    def test_outputs_never_carry_per_rule_breakdowns(self):
        report = self.run_main()

        self.assertNotIn(RULE_ID, report)
        self.assertNotIn(RULE_ID, (self.out / "report.json").read_text())


if __name__ == "__main__":
    unittest.main()
