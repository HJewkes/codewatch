"""Erosion and verbosity headline without the agent's tests, so test bloat cannot dilute them (C-235)."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from analysis.__main__ import main

from .fixtures import FLAG, evaluation, fake_scb_check, stage, stages_json, write_checkpoint

HERE = Path(__file__).parent
PROBLEMS = ("alpha", "beta", "gamma")
SOURCE = {"src/complex_app.py": f"a = 1  {FLAG}\nb = 2  {FLAG}\nc = 3\nd = 4\n"}
PLAIN_TEST = "x = 0\ny = 0\nz = 0\nw = 0\n"


def tree(test_files: int) -> dict[str, str]:
    """The same source in every arm; only the number of plain test files differs."""
    return SOURCE | {f"tests/test_app_{i}.py": PLAIN_TEST for i in range(test_files)}


def write_arm(root: Path, test_files: int, stages=None) -> None:
    for problem in PROBLEMS:
        for index in (1, 2):
            write_checkpoint(root, problem, index, evaluation(index), files=tree(test_files), stages=stages)


class TestHeavyArmTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        root = Path(self._tmp.name)
        self.out = root / "out"
        write_arm(root / "a0", test_files=1)
        write_arm(root / "a0r", test_files=1)
        write_arm(root / "a1a", test_files=1)
        write_arm(root / "a1", test_files=9, stages=stages_json(stage("audit", items_out=2)))
        argv = ["--a0", str(root / "a0"), "--a1a", str(root / "a1a"), "--a1", str(root / "a1"),
                "--a0-replicate", str(root / "a0r"), "--out", str(self.out), "--scratch", str(root / "s")]
        with contextlib.redirect_stdout(io.StringIO()):
            main(argv, scb_check=fake_scb_check)
        self.data = json.loads((self.out / "report.json").read_text())

    def tearDown(self):
        self._tmp.cleanup()

    def test_the_decision_follows_the_tests_excluded_numbers_not_the_diluted_full_tree(self):
        decision = self.data["decision"]

        self.assertEqual(decision["verdict"], "drop")
        self.assertEqual((decision["delta_erosion"], decision["delta_verbosity"]), (0.0, 0.0))
        self.assertAlmostEqual(decision["delta_erosion_full"], -0.8)
        self.assertAlmostEqual(decision["delta_verbosity_full"], -0.8)

    def test_consistency_counts_the_tests_excluded_direction(self):
        consistency = self.data["consistency"]

        self.assertEqual((consistency["erosion"]["lower"], consistency["verbosity"]["lower"]), (0, 0))

    def test_every_arm_including_the_replicate_has_tests_excluded_numbers(self):
        summaries = self.data["summaries"]

        for name in ("A0", "A0'", "A1a", "A1"):
            self.assertEqual(summaries[name]["erosion_ex_tests"], 1.0, name)
            self.assertEqual(summaries[name]["verbosity_ex_tests"], 0.5, name)

    def test_checkpoint_rows_carry_the_headline_and_the_full_tree_beside_it(self):
        a1 = self.data["checkpoints"][0]["arms"]["A1"]
        delta = self.data["checkpoints"][0]["a1_minus_a1a"]

        self.assertEqual((a1["erosion_ex_tests"], a1["verbosity_ex_tests"]), (1.0, 0.5))
        self.assertAlmostEqual(a1["erosion"], 0.1)
        self.assertEqual(delta["erosion_ex_tests"], 0.0)

    def test_the_markdown_puts_the_tests_excluded_deltas_first(self):
        report = (self.out / "report.md").read_text()

        self.assertIn("- ΔE (tests excluded) = +0.0%", report)
        self.assertIn("- ΔE full tree (secondary) = -80.0%", report)


if __name__ == "__main__":
    unittest.main()
