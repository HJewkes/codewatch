"""solve-review stage tests: a real hidden repository and the real review command, with a fake
`claude` answering the review call and a fake solve session answering the resume."""

from __future__ import annotations

import json
import os
import shlex
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from prflow.repo import HiddenRepo
from remediation.fixer import Clock
from remediation.session import run_process
from review import IMAGE_COMMAND
from review.solve import Config, parse_args, solve_review
from tests.remediation_support import FakeClaude, writes

BENCH = Path(__file__).resolve().parents[1]
IMAGE_ROOT, IMAGE_PYTHON = "/opt/codewatch-a1", "/opt/codewatch-a1/py/bin/python"
SPEC = ["# Shop, part 2", "", "The receipt ends with a total line.",
        "The total line prints the amount in dollars with two decimal places."]
GOLDEN = "tests/golden/receipt.txt"
CONFLICT = {"verdict": "conflict", "spec_line": 4, "spec_quote": SPEC[3], "reason": "The golden total lost its cents."}
SOLVE_ID = "solve-session-1"
FRAGMENT = ".codewatch/verdicts.d/cp-2.jsonl"

REVIEWER = """\
import json, sys
from pathlib import Path
log = Path({log!r})
log.mkdir(exist_ok=True)
n = len(list(log.iterdir()))
(log / f"{{n}}.txt").write_text(sys.stdin.read())
replies = json.loads({replies!r})
print(json.dumps({{"result": json.dumps(replies[n]), "usage": {{"input_tokens": 100}}, "total_cost_usd": 0.01}}))
"""


class SolveReviewTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.workspace, self.spec, self.prompts = self.tmp / "workspace", self.tmp / "cw-spec" / "cp-2.md", self.tmp / "prompts"
        self.workspace.mkdir()
        self.spec.parent.mkdir()
        self.spec.write_text("\n".join(SPEC) + "\n")
        self.repo = HiddenRepo.at(self.workspace)
        self.repo.init()
        self.repo.ensure_excludes()
        self.write({"shop/pricing.py": "def total(c):\n    return f'Total: {c / 100:.2f}'\n", GOLDEN: "Total: 2.50\n"})
        self.base = self.repo.commit_all("cp-1")
        self.repo.run("switch", "-q", "-c", "cp-2")

    def write(self, files: dict[str, str]) -> None:
        for path, text in files.items():
            (self.workspace / path).parent.mkdir(parents=True, exist_ok=True)
            (self.workspace / path).write_text(text)

    def solve(self, files: dict[str, str]) -> str:
        self.write(files)
        return self.repo.commit_all("cp-2: solve")

    def reviewer(self, *replies: dict) -> None:
        script = self.tmp / "bin" / "claude"
        script.parent.mkdir(exist_ok=True)
        script.write_text(f"#!{sys.executable}\n" + REVIEWER.format(log=str(self.prompts), replies=json.dumps(replies)))
        script.chmod(0o755)

    def review_prompts(self) -> list[str]:
        return [p.read_text() for p in sorted(self.prompts.iterdir())] if self.prompts.is_dir() else []

    def run_stage(self, claude: FakeClaude, session_id: str | None = SOLVE_ID, clock: Clock | None = None) -> dict:
        local = IMAGE_COMMAND.replace(IMAGE_PYTHON, sys.executable).replace(IMAGE_ROOT, str(BENCH))
        command = [*shlex.split(local), "--mode", "expected-output", "--spec", str(self.spec)]
        config = Config(self.workspace, command, 2, session_id, None, 60.0)
        env = {"PATH": f"{self.tmp / 'bin'}:{os.environ['PATH']}", "CW_MODEL": "sonnet-test"}
        with mock.patch.dict(os.environ, env):
            return solve_review(config, env, claude, run_process, clock or Clock(None, 60.0))

    def head_file(self, path: str) -> str:
        return self.repo.run("show", f"HEAD:{path}")


class ConflictTest(SolveReviewTestCase):
    def test_an_edited_golden_file_the_spec_does_not_require_is_a_conflict_resumed_once(self):
        solve = self.solve({"shop/pricing.py": "def total(c):\n    return f'Total: {c / 100}'\n", GOLDEN: "Total: 2.5\n"})
        self.write({FRAGMENT: '{"key": "k"}\n'})
        self.reviewer(CONFLICT)
        claude = FakeClaude(writes(GOLDEN, "Total: 2.50\n"))

        report = self.run_stage(claude)

        self.assertEqual((report["verdict"], report["resumed"], report["second_verdict"], report["outcome"]),
                         ("conflict", True, "ok", "revised"))
        self.assertEqual((report["solve_commit"], report["spec_line"], report["session_id"]), (solve, 4, SOLVE_ID))
        self.assertEqual(len(claude.calls), 1)
        self.assertEqual(claude.calls[0][claude.calls[0].index("--resume") + 1], SOLVE_ID)
        self.assertIn("(specification line 4): The golden total lost its cents.", claude.prompts()[0])
        self.assertEqual(len(self.review_prompts()), 1)
        self.assertEqual(self.head_file(GOLDEN), "Total: 2.50")
        self.assertEqual((report["revised_commit"], self.repo.rev("HEAD^")), (self.repo.rev("HEAD"), self.base))
        self.assertEqual(self.repo.run("status", "--porcelain", "-uall"), f"?? {FRAGMENT}")

    def test_a_conflict_that_stands_after_the_resume_is_recorded_and_the_revision_kept(self):
        self.solve({GOLDEN: "Total: 2.5\n"})
        self.reviewer(CONFLICT, CONFLICT)

        report = self.run_stage(FakeClaude(writes(GOLDEN, "Total: 2.50 USD\n")))

        self.assertEqual((report["second_verdict"], report["outcome"]), ("conflict", "conflict"))
        self.assertEqual(self.head_file(GOLDEN), "Total: 2.50 USD")

    def test_a_resume_that_changes_nothing_skips_the_second_review(self):
        solve = self.solve({GOLDEN: "Total: 2.5\n"})
        self.reviewer(CONFLICT)

        report = self.run_stage(FakeClaude(None))

        self.assertEqual((report["resumed"], report["second_verdict"], report["outcome"]), (True, None, "conflict"))
        self.assertEqual((len(self.review_prompts()), self.repo.rev("HEAD")), (1, solve))

    def test_a_resume_that_times_out_leaves_the_solve_as_it_was(self):
        solve = self.solve({GOLDEN: "Total: 2.5\n"})
        self.reviewer(CONFLICT)

        report = self.run_stage(FakeClaude(writes(GOLDEN, "half"), timeout_on=1))

        self.assertEqual((report["outcome"], self.repo.rev("HEAD")), ("conflict", solve))
        self.assertEqual((self.workspace / GOLDEN).read_text(), "Total: 2.5\n")

    def test_without_a_solve_session_id_the_conflict_is_recorded_with_no_resume(self):
        self.solve({GOLDEN: "Total: 2.5\n"})
        self.reviewer(CONFLICT)
        claude = FakeClaude()

        report = self.run_stage(claude, session_id=None)

        self.assertEqual((report["outcome"], report["resumed"], claude.calls), ("conflict", False, []))
        self.assertIn("no solve session id", report["reason"])


class NoChangeTest(SolveReviewTestCase):
    def test_a_solve_with_no_expected_output_change_is_ok_with_no_model_call(self):
        self.solve({"shop/pricing.py": "def total(c):\n    return f'Total: {c / 100:.2f}'\n\n\nX = 1\n",
                    "tests/test_pricing.py": "def test_total():\n    assert True\n"})
        self.reviewer()
        claude = FakeClaude()

        report = self.run_stage(claude)

        self.assertEqual((report["outcome"], report["verdict"], report["resumed"]), ("ok", "ok", False))
        self.assertEqual((self.review_prompts(), claude.calls, report["tokens"]), ([], [], 0))

    def test_a_head_off_the_pr_branch_is_skipped(self):
        self.repo.run("switch", "-q", "main")

        report = self.run_stage(FakeClaude())

        self.assertEqual(report["outcome"], "skipped")


class ArgsTest(unittest.TestCase):
    def test_the_session_id_checkpoint_and_deadline_default_to_the_stage_env(self):
        env = {"CW_SOLVE_SESSION_ID": SOLVE_ID, "CW_CHECKPOINT": "3", "CW_STAGE_DEADLINE": "1700000000"}

        config = parse_args(["--workspace", "/w", "--review-command", "review --mode expected-output"], env)

        self.assertEqual((config.session_id, config.checkpoint, config.deadline), (SOLVE_ID, 3, 1700000000.0))
        self.assertEqual(config.review_command, ["review", "--mode", "expected-output"])


if __name__ == "__main__":
    unittest.main()
