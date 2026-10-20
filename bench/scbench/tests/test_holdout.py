import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from regrade import holdout
from regrade.__main__ import main as regrade_main

HERE = Path(__file__).parent
BENCH = HERE.parent
HARNESS = BENCH / "c239" / "harness"
HELD = "held_problem"


def write_manifest(path, held=(HELD,)):
    tiers = {"Easy": list(held), "Medium": [], "Hard": []}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"holdout": {"problems": tiers, "checkpoints": 1}}))
    return path


def write_ledger(path, *rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


class HoldoutGuardTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.home = Path(self._tmp.name)
        self.manifest = write_manifest(self.home / ".cache" / "codewatch-scbench" / "manifest.json")
        self.ledger = self.home / ".cache" / "codewatch-scbench" / "climb" / "ledger.jsonl"

    def tearDown(self):
        self._tmp.cleanup()

    def check(self, problems, milestone=None):
        holdout.check(problems, milestone, self.manifest, self.ledger)

    def test_dev_problem_runs_without_a_milestone(self):
        self.check(["dev_problem"])

    def test_holdout_problem_is_refused_without_a_milestone(self):
        with self.assertRaises(holdout.HoldoutRefused) as refused:
            self.check(["dev_problem", HELD])
        self.assertIn("1 of 2", str(refused.exception))
        self.assertNotIn(HELD, str(refused.exception))

    def test_milestone_without_a_ledger_row_is_refused(self):
        write_ledger(self.ledger, {"split": "dev", "milestone": "m1", "ownerApproved": True})
        with self.assertRaises(holdout.HoldoutRefused):
            self.check([HELD], "m1")

    def test_unapproved_ledger_row_is_refused(self):
        write_ledger(self.ledger, {"split": "holdout", "milestone": "m1", "ownerApproved": "yes"})
        with self.assertRaises(holdout.HoldoutRefused):
            self.check([HELD], "m1")

    def test_approved_row_for_another_milestone_is_refused(self):
        write_ledger(self.ledger, {"split": "holdout", "milestone": "m2", "ownerApproved": True})
        with self.assertRaises(holdout.HoldoutRefused):
            self.check([HELD], "m1")

    def test_milestone_with_an_owner_approved_row_runs(self):
        write_ledger(self.ledger, {"split": "holdout", "milestone": "m1", "ownerApproved": True})
        self.check([HELD], "m1")

    def test_unreadable_manifest_refuses_every_problem(self):
        self.manifest.write_text("{}")
        with self.assertRaises(holdout.HoldoutRefused):
            self.check(["dev_problem"])

    def test_regrade_refuses_a_holdout_problem_before_grading(self):
        argv = ["--problem", HELD, "--checkpoint", "1", "--base", "b", "--head", "h", "--out", "o.json"]
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = regrade_main(argv, scb_check=None, hidden_eval=None,
                                holdout_check=lambda p: self.check([p]))
        self.assertEqual(code, holdout.REFUSED_EXIT)
        self.assertNotIn(HELD, stderr.getvalue())

    def test_every_harness_script_refuses_a_holdout_problem(self):
        env = {**os.environ, "HOME": str(self.home)}
        env.pop(holdout.MILESTONE_ENV, None)
        for script in ("run_c241.sh", "newc_arm.sh", "new_arm.sh", "old_arm.sh", "eval.sh", "post.sh",
                       "freeze_c241.sh"):
            with self.subTest(script=script):
                result = subprocess.run(["bash", str(HARNESS / script), HELD, "2", "x", "y", "z"],
                                        capture_output=True, text=True, env=env, cwd=self.home)
                self.assertEqual(result.returncode, holdout.REFUSED_EXIT, result.stderr)
                self.assertNotIn(HELD, result.stdout + result.stderr)

    def test_guard_cli_exits_zero_for_dev_problems(self):
        env = {**os.environ, "HOME": str(self.home)}
        result = subprocess.run([sys.executable, "-I", str(BENCH / "regrade" / "holdout.py"), "dev_problem"],
                                capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
