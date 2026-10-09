"""Review command tests on a hidden-repository fixture, with the model mocked."""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from synthesis.rubric import ModelReply, claude_argv

from review import __main__ as cli
from review.inputs import InputError, expected_output_diff
from review.stage import Request, review
from review.verdict import EXPECTED_OUTPUT, FIX, QUESTIONS, REPLY_FORMAT, SYSTEM_PROMPT, ReplyError, parse_reply

FORBIDDEN = ("scb-check", "scb_check", "erosion", "verbosity", "grader", "grade", "slop")
SPEC = [
    "# Shop, part 2",
    "",
    "The receipt ends with a total line.",
    "The total line prints the amount in dollars with two decimal places.",
]
PRICING = 'def format_total(cents):\n    return f"Total: {cents / 100:.2f}"\n'
RECEIPT = "from shop.pricing import format_total\n\n\ndef receipt(cents):\n    return format_total(cents)\n"
TEST = 'from shop.receipt import receipt\n\n\ndef test_total():\n    assert receipt(250) == "Total: 2.50"\n'


class FakeModel:
    def __init__(self, *replies: dict | str) -> None:
        self.replies = [r if isinstance(r, str) else json.dumps(r) for r in replies]
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> ModelReply:
        self.prompts.append(prompt)
        return ModelReply(text=self.replies.pop(0), tokens=900, usd=0.01)


class HiddenRepoTestCase(unittest.TestCase):
    def setUp(self) -> None:
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.workspace, self.spec = root / "workspace", root / "spec.md"
        self.spec.write_text("\n".join(SPEC) + "\n")
        git_dir = self.workspace / ".codewatch" / "repo.git"
        self.enterContext(mock.patch.dict(os.environ, {
            "GIT_DIR": str(git_dir), "GIT_WORK_TREE": str(self.workspace),
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@localhost",
            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@localhost"}))
        git_dir.parent.mkdir(parents=True)
        self.git("init", "-q", "-b", "main")
        (self.workspace / "NOTES.md").write_text("Totals are formatted in shop/pricing.py.\n")
        self.solve = self.commit("solve", {"shop/pricing.py": PRICING, "shop/receipt.py": RECEIPT,
                                           "tests/test_receipt.py": TEST})

    def git(self, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=self.workspace, capture_output=True, text=True,
                              check=True).stdout.strip()

    def commit(self, message: str, files: dict[str, str]) -> str:
        for path, text in files.items():
            (self.workspace / path).parent.mkdir(parents=True, exist_ok=True)
            (self.workspace / path).write_text(text)
        self.git("add", "-A", "--", ":!.codewatch")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def request(self, sha: str, mode: str = FIX) -> Request:
        return Request(sha, self.spec, self.workspace, mode, "tests")


class FixCommitTest(HiddenRepoTestCase):
    def test_a_planted_behaviour_changing_refactor_is_reported_as_a_cited_conflict(self):
        sha = self.commit("simplify total", {"shop/pricing.py": PRICING.replace("{cents / 100:.2f}", "{cents // 100}")})
        model = FakeModel({"verdict": "conflict", "spec_line": 4, "spec_quote": SPEC[3],
                           "reason": "The total now drops the cents."})

        report = review(self.request(sha), model)

        self.assertEqual((report["verdict"], report["spec_line"], report["citation"]), ("conflict", 4, "verified"))
        self.assertIn('-    return f"Total: {cents / 100:.2f}"', model.prompts[0])
        self.assertIn('+    return f"Total: {cents // 100}"', model.prompts[0])

    def test_a_pure_rename_is_reported_ok(self):
        sha = self.commit("rename", {"shop/pricing.py": PRICING.replace("format_total", "render_total"),
                                     "shop/receipt.py": RECEIPT.replace("format_total", "render_total")})
        model = FakeModel({"verdict": "ok", "spec_line": None, "reason": "Only a function name changes."})

        report = review(self.request(sha), model)

        self.assertEqual((report["verdict"], report["spec_line"], report["citation"]), ("ok", None, "none"))
        self.assertEqual(report["files"], ["shop/pricing.py", "shop/receipt.py"])

    def test_the_prompt_carries_the_numbered_spec_the_notes_and_the_diff(self):
        sha = self.commit("rename", {"shop/pricing.py": PRICING.replace("format_total", "render_total")})
        model = FakeModel({"verdict": "ok", "spec_line": None, "reason": "rename"})

        review(self.request(sha), model)

        self.assertIn(f"   4| {SPEC[3]}", model.prompts[0])
        self.assertIn("Totals are formatted in shop/pricing.py.", model.prompts[0])
        self.assertIn("diff --git a/shop/pricing.py b/shop/pricing.py", model.prompts[0])

    def test_a_quote_that_is_not_on_the_cited_line_drops_the_citation(self):
        sha = self.commit("simplify", {"shop/pricing.py": PRICING.replace(":.2f", "")})
        model = FakeModel({"verdict": "conflict", "spec_line": 3, "spec_quote": SPEC[3], "reason": "cents"})

        report = review(self.request(sha), model)

        self.assertEqual((report["verdict"], report["spec_line"], report["citation"]), ("conflict", None, "failed"))

    def test_a_line_past_the_end_of_the_spec_drops_the_citation(self):
        sha = self.commit("simplify", {"shop/pricing.py": PRICING.replace(":.2f", "")})
        model = FakeModel({"verdict": "conflict", "spec_line": 40, "spec_quote": "Total", "reason": "cents"})

        self.assertEqual(review(self.request(sha), model)["citation"], "failed")

    def test_spec_text_repeated_in_the_reason_is_replaced(self):
        sha = self.commit("simplify", {"shop/pricing.py": PRICING.replace(":.2f", "")})
        model = FakeModel({"verdict": "conflict", "spec_line": 4, "spec_quote": SPEC[3],
                           "reason": f"The spec says: {SPEC[3]}"})

        report = review(self.request(sha), model)

        self.assertEqual(report["reason"], "The spec says: <spec>")
        self.assertNotIn(SPEC[3], json.dumps(report))


SOLVE_TEST = TEST.replace('"Total: 2.50"', '"Total: 2.5"')
GOLDEN = "tests/golden/receipt.txt"


class SolveCommitTest(HiddenRepoTestCase):
    def test_only_golden_files_and_edited_assertions_reach_the_model(self):
        sha = self.commit("solve 3", {"shop/pricing.py": PRICING.replace(":.2f", ""), GOLDEN: "Total: 2.5\n",
                                      "tests/test_receipt.py": SOLVE_TEST})
        model = FakeModel({"verdict": "conflict", "spec_line": 4, "spec_quote": SPEC[3], "reason": "cents"})

        report = review(self.request(sha, EXPECTED_OUTPUT), model)

        self.assertEqual(report["files"], [GOLDEN, "tests/test_receipt.py"])
        self.assertNotIn("diff --git a/shop/pricing.py", model.prompts[0])
        self.assertIn(QUESTIONS[EXPECTED_OUTPUT], model.prompts[0])

    def test_a_solve_commit_that_only_adds_tests_makes_no_model_call(self):
        extra = TEST + '\n\ndef test_zero():\n    assert receipt(0) == "Total: 0.00"\n'
        sha = self.commit("solve 3", {"tests/test_receipt.py": extra, "shop/extra.py": "X = 1\n"})
        model = FakeModel()

        report = review(self.request(sha, EXPECTED_OUTPUT), model)

        self.assertEqual((report["verdict"], report["files"], model.prompts), ("ok", [], []))

    def test_a_removed_diff_header_is_not_read_as_an_assertion(self):
        diff = "diff --git a/tests/test_a.py b/tests/test_a.py\n--- a/tests/test_a.py\n+++ b/tests/test_a.py\n+x = 1\n"

        self.assertEqual(expected_output_diff(diff, "tests"), ("", []))


class CommandTest(HiddenRepoTestCase):
    def run_main(self, *argv: str, reply: dict | str = '{"verdict": "ok", "spec_line": null, "reason": "r"}'):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(cli, "call_model", FakeModel(reply)), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_the_last_stdout_line_is_the_verdict_the_fix_stage_hook_reads(self):
        sha = self.commit("rename", {"shop/pricing.py": PRICING.replace("format_total", "render_total")})

        code, out, _ = self.run_main("--spec", str(self.spec), "--workspace", str(self.workspace), sha)

        report = json.loads(out.splitlines()[-1])
        self.assertEqual((code, report["verdict"], report["spec_line"], report["reason"]), (0, "ok", None, "r"))

    def test_the_spec_file_defaults_to_the_environment(self):
        sha = self.commit("rename", {"shop/pricing.py": PRICING.replace("format_total", "render_total")})

        with mock.patch.dict(os.environ, {"CW_SPEC_FILE": str(self.spec)}):
            code, _, _ = self.run_main("--workspace", str(self.workspace), sha)

        self.assertEqual(code, 0)

    def test_a_spec_inside_the_workspace_is_refused(self):
        inside = self.workspace / ".codewatch" / "spec.md"
        inside.write_text("\n".join(SPEC))

        code, out, err = self.run_main("--spec", str(inside), "--workspace", str(self.workspace), self.solve)

        self.assertEqual((code, out), (1, ""))
        self.assertIn("inside the workspace", err)

    def test_a_reply_without_a_verdict_exits_1(self):
        code, _, err = self.run_main("--spec", str(self.spec), "--workspace", str(self.workspace), self.solve,
                                     reply='{"verdict": "maybe"}')

        self.assertEqual(code, 1)
        self.assertIn("ReplyError", err)

    def test_an_unknown_commit_exits_1(self):
        code, _, err = self.run_main("--spec", str(self.spec), "--workspace", str(self.workspace), "0" * 40)

        self.assertEqual(code, 1)
        self.assertIn(InputError.__name__, err)


class PromptTest(unittest.TestCase):
    def test_the_fixed_prompt_text_names_no_grader_or_its_metrics(self):
        fixed = " ".join([SYSTEM_PROMPT, REPLY_FORMAT, *QUESTIONS.values()]).lower()

        for term in FORBIDDEN:
            self.assertNotIn(term, fixed)

    def test_the_call_has_no_tools_servers_or_settings(self):
        argv = claude_argv("claude-sonnet-5-5", SYSTEM_PROMPT)

        self.assertEqual(argv[argv.index("--system-prompt") + 1], SYSTEM_PROMPT)
        self.assertIn("Bash", argv[argv.index("--disallowedTools") + 1])
        self.assertEqual(argv[argv.index("--mcp-config") + 1], '{"mcpServers":{}}')
        self.assertEqual(argv[argv.index("--setting-sources") + 1], "")

    def test_a_fenced_reply_is_read(self):
        self.assertEqual(parse_reply('```json\n{"verdict": "ok"}\n```')["verdict"], "ok")

    def test_a_reply_that_is_not_json_is_rejected(self):
        with self.assertRaises(ReplyError):
            parse_reply("The commit looks fine.")


if __name__ == "__main__":
    unittest.main()
