import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from analysis.__main__ import main

from .fixtures import evaluation, source_file, stage, write_checkpoint

HERE = Path(__file__).parent
PROBLEMS = ("alpha", "beta", "gamma")
RULE_ID = "synthetic-rule-id-should-never-appear"


def write_arm(root: Path, high_cc: int, cost: float, stages=None):
    for problem in PROBLEMS:
        for index in (1, 2):
            files = [source_file("src/app.py", high_cc), source_file("tests/test_app.py", 2)]
            raw = evaluation(index, files=files, cost=cost)
            raw["quality"]["rules"] = {RULE_ID: 7}
            write_checkpoint(root, problem, index, raw, stages)


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        root = Path(self._tmp.name)
        self.out = root / "out"
        a1_stages = {"stages": [stage("audit", items_out=4), stage("triage", usd=0.4)]}
        write_arm(root / "a0", high_cc=14, cost=1.0)
        write_arm(root / "a1a", high_cc=14, cost=1.1)
        write_arm(root / "a1", high_cc=8, cost=1.2, stages=a1_stages)
        self.argv = ["--a0", str(root / "a0"), "--a1a", str(root / "a1a"),
                     "--a1", str(root / "a1"), "--out", str(self.out)]

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self) -> str:
        with contextlib.redirect_stdout(io.StringIO()):
            main(self.argv)
        return (self.out / "report.md").read_text()

    def test_report_carries_every_section_six_part(self):
        report = self.run_main()

        for heading in ("## Verdict:", "## Arms", "## Gaming checks", "## Mechanism signals",
                        "## Per-problem final checkpoints", "## Paired per-checkpoint deltas"):
            self.assertIn(heading, report)

    def test_erosion_gone_without_verbosity_change_iterates(self):
        self.run_main()

        data = json.loads((self.out / "report.json").read_text())

        self.assertEqual(data["decision"]["verdict"], "iterate")
        self.assertEqual(data["decision"]["reasons"], ["only one of ΔE or ΔV met T"])
        self.assertEqual(len(data["checkpoints"]), 6)
        self.assertEqual([f["checkpoint"] for f in data["finals"]], [2, 2, 2])
        self.assertEqual(data["fire_rate"], 1.0)

    def test_outputs_never_carry_per_rule_breakdowns(self):
        report = self.run_main()

        self.assertNotIn(RULE_ID, report)
        self.assertNotIn(RULE_ID, (self.out / "report.json").read_text())


if __name__ == "__main__":
    unittest.main()
