"""Synthesis stage tests on a Python workspace in a real hidden repo, with codewatch and the model faked."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from prflow.pr import pr_open, repo_init
from prflow.ratchet import commit_ratchet
from prflow.repo import HiddenRepo
from synthesis.inputs import read_verdicts, recorded_taste
from synthesis.report import pr_report, render_markdown
from synthesis.stage import run_stage
from synthesis.taste import (
    INSTRUCTIONS,
    MAX_FRAGMENT_WORDS,
    SYSTEM_PROMPT,
    ModelReply,
    build_prompt,
    cap_lines,
    claude_argv,
    listed_verdicts,
    tagged_lines,
)

FORBIDDEN = ("scb-check", "scb_check", "erosion", "verbosity", "grader", "grade", "slop", "regnet")


def _verdict(signal: str, verdict: str, path: str, line: int, rationale: str) -> dict:
    return {"key": f"code-graph:{signal}:{path}:0123456789abcdef#0", "verdict": verdict, "rationale": rationale,
            "signal": signal, "path": path, "tool": "code-graph", "excerptHash": "e", "provenance": "model",
            "citations": [{"path": path, "lineStart": line, "lineEnd": line, "quote": "x"}]}


VERDICTS = [
    _verdict("symbol-pass-through", "justified", "shop/cart.py", 3, "Marks the public API boundary."),
    _verdict("symbol-cognitive", "confirmed", "shop/pricing.py", 12, "Two discount paths repeat the rounding."),
    _verdict("clone", "confirmed", "shop/cart.py", 30, "Both copies parse a price the same way."),
    _verdict("symbol-comment-ratio", "unclear", "shop/cart.py", 40, "Hard to say."),
]
RULES = [{"type": "metric-max", "kind": "file", "metric": "cognitive_max", "max": 15}]
VIOLATIONS = [
    {"ruleId": "max-cc", "severity": "error", "nodeId": "shop/pricing.py", "path": "shop/pricing.py", "lineStart": 12,
     "message": "too complex", "evidence": "symbol_cyclomatic=14 (max 10)"},
    {"ruleId": "max-cc", "severity": "error", "nodeId": "shop/cart.py", "path": "shop/cart.py", "isCarryover": True,
     "message": "old"},
]
METRIC_DELTAS = [
    {"nodeId": "shop/pricing.py", "name": "cognitive_max", "before": 5, "after": 13, "delta": 8},
    {"nodeId": "shop/cart.py", "name": "loc", "before": None, "after": 300, "delta": None},
    {"nodeId": "shop/cart.py", "name": "fan_in", "before": 1, "after": 4, "delta": 3},
]
FOOTPRINT = {"changes": [
    {"symbolId": "shop/pricing.py#apply_discount", "status": "changed", "fileId": "shop/pricing.py"},
    {"symbolId": "shop/cart.py#Cart.total", "status": "added", "fileId": "shop/cart.py"},
    {"symbolId": "shop/cart.py#old_total", "status": "removed", "fileId": "shop/cart.py"},
    {"symbolId": "shop/cli.py#main", "status": "changed", "fileId": "shop/cli.py"},
]}
TOP = {"rows": [{"nodeId": "shop/cart.py", "value": 4}, {"nodeId": "shop/pricing.py", "value": 2}]}
REPLY = "\n".join([
    "- Keep discount rounding in one function in shop/pricing.py. [1]",
    "- Share one price parser instead of copying it. [2]",
    "- The thin Cart wrapper marks the API boundary; keep it. [3]",
    "- A line without a citation.",
    "- A line citing a verdict that was not listed. [9]",
])


class FakeCodewatch:
    """Both stage interfaces: prflow's `(args, env, cwd)` tool and synthesis's `(args)` CLI."""

    HEAD, BASE = {"id": 8, "commitHash": "a" * 40}, {"id": 7, "commitHash": "b" * 40}

    def __init__(self, has_rev: bool = True) -> None:
        self.has_rev = has_rev
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str], env=None, cwd: Path | None = None) -> subprocess.CompletedProcess | str:
        self.calls.append(args)
        code, stdout = self._answer(args, cwd)
        return stdout if env is None else subprocess.CompletedProcess(args, code, stdout, "")

    def _answer(self, args: list[str], cwd: Path | None) -> tuple[int, str]:
        if args[:2] == ["graph", "init"]:
            (cwd / ".codewatch" / "check.json").write_text(json.dumps({"rules": RULES}) + "\n")
            return 0, ""
        if "--help" in args:
            return 0, "--ref <ref>\n" + ("--rev <rev>\n" if self.has_rev else "")
        baseline = self.BASE if "--baseline" in args else None
        if args[:2] == ["graph", "check"]:
            return 1, json.dumps({"snapshot": self.HEAD, "baselineSnapshot": baseline,
                                  "result": {"passed": False, "newErrors": 1, "newWarnings": 0, "carryoverErrors": 1,
                                             "carryoverWarnings": 0, "violations": VIOLATIONS}})
        if args[:2] == ["graph", "diff"] and "--footprint" in args:
            return 0, json.dumps(FOOTPRINT)
        if args[:2] == ["graph", "diff"]:
            return 0, json.dumps({"from": self.BASE, "to": self.HEAD, "diff": {"metricDeltas": METRIC_DELTAS}})
        if args[:2] == ["graph", "top"]:
            return 0, json.dumps(TOP)
        return 0, ""

    def find(self, *prefix: str) -> list[str]:
        return next(c for c in reversed(self.calls) if c[:len(prefix)] == list(prefix))


class FakeModel:
    def __init__(self, reply: ModelReply | Exception) -> None:
        self.reply = reply
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> ModelReply:
        self.prompts.append(prompt)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


class StageTestCase(unittest.TestCase):
    def setUp(self) -> None:
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.workspace = Path(scratch.name).resolve()
        patcher = mock.patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = HiddenRepo.at(self.workspace)
        self.codewatch = FakeCodewatch()
        (self.workspace / "shop").mkdir()
        (self.workspace / "pyproject.toml").write_text('[project]\nname = "shop"\nversion = "0.1.0"\n')
        (self.workspace / "shop" / "cart.py").write_text("def total(prices):\n    return sum(prices)\n")

    def open_pr(self, verdicts: list[dict] = VERDICTS) -> None:
        repo_init(self.repo, self.codewatch)
        pr_open(self.repo, 1)
        commit_ratchet(self.repo, 1, self.codewatch)
        self.write_verdicts(verdicts)

    def write_verdicts(self, verdicts: list[dict]) -> None:
        audit = self.workspace / ".codewatch" / "audit"
        audit.mkdir(parents=True, exist_ok=True)
        (audit / "verdicts.jsonl").write_text("".join(json.dumps(v) + "\n" for v in verdicts))

    def run_stage(self, model: FakeModel) -> dict:
        return run_stage(self.workspace, 1, self.codewatch, model, self.codewatch)

    def read(self, rel: str) -> str:
        return (self.workspace / ".codewatch" / rel).read_text()

    def read_merged(self, rel: str) -> str:
        """A file as the PR merged it, before the fold on `main` absorbed it."""
        return self.repo.run("show", f"main^:.codewatch/{rel}") + "\n"


class RunStageTest(StageTestCase):
    def test_writes_a_tagged_taste_fragment_and_merges_the_pr_with_the_report_as_its_message(self) -> None:
        self.open_pr()

        report = self.run_stage(FakeModel(ModelReply(text=REPLY, tokens=22000, usd=0.07)))

        listed = listed_verdicts(VERDICTS)
        taste = [
            f"- Keep discount rounding in one function in shop/pricing.py. {{inferred cp1 fp:{listed[0]['key']}}}",
            f"- Share one price parser instead of copying it. {{inferred cp1 fp:{listed[1]['key']}}}",
            f"- The thin Cart wrapper marks the API boundary; keep it. {{inferred cp1 fp:{listed[2]['key']}}}",
        ]
        self.assertEqual(self.read_merged("taste.d/cp-1.md").splitlines(), taste)
        self.assertEqual(self.read("taste.md").splitlines(), taste)
        self.assertEqual(report, {"tokens": 22000, "usd": 0.07, "items_in": 4 + 1 + 2, "items_out": 3,
                                  "outcome": "written", "branch": "cp-1", "baseline": "cw-merge-base-cp-1",
                                  "merge": "merged", "merge_commit": self.repo.rev("main^"),
                                  "fold": {"absorbed": 1, "anchors": "unknown", "outcome": "folded",
                                           "fold_commit": self.repo.rev("main")}})
        message = self.repo.run("log", "-1", "--format=%B", "main^")
        self.assertEqual(message, "Merge cp-1 into main\n\n" + render_markdown(json.loads(self.read("audit/pr-report.json"))).strip())
        self.assertEqual(self.repo.branch(), "main")
        merged = self.repo.run("ls-tree", "-r", "--name-only", "main^").splitlines()
        self.assertIn(".codewatch/taste.d/cp-1.md", merged)
        self.assertNotIn(".codewatch/session-brief.json", merged)
        self.assertNotIn(".codewatch/taste.md", merged)
        folded = self.repo.run("ls-tree", "-r", "--name-only", "main").splitlines()
        self.assertIn(".codewatch/taste.md", folded)
        self.assertNotIn(".codewatch/taste.d/cp-1.md", folded)

    def test_ratchets_the_current_head_against_the_merge_base(self) -> None:
        self.open_pr()
        merge_base = self.repo.merge_base()
        (self.workspace / "tests").mkdir()
        (self.workspace / "tests" / "test_cart.py").write_text("def test_total():\n    assert True\n")
        fix = self.repo.commit_all("cp-1: fix")

        self.run_stage(FakeModel(ModelReply("", 1, 0.0)))

        index_calls = [c for c in self.codewatch.calls if c[:2] == ["graph", "index"] and "--help" not in c]
        self.assertEqual([c[c.index("--rev") + 1] for c in index_calls[-2:]], [fix, merge_base])
        check = self.codewatch.find("graph", "check")
        self.assertEqual(check[check.index("--baseline") + 1], "cw-merge-base-cp-1")
        footprint = next(c for c in self.codewatch.calls if "--footprint" in c)
        self.assertEqual((footprint[footprint.index("--from") + 1], footprint[footprint.index("--to") + 1]), ("7", "8"))
        top = self.codewatch.find("graph", "top")
        self.assertEqual(top[top.index("--snapshot") + 1], "8")

    def test_writes_a_derived_brief_of_new_violations_and_most_imported_changed_symbols(self) -> None:
        self.open_pr()

        self.run_stage(FakeModel(ModelReply("", 1, 0.0)))

        self.assertEqual(json.loads(self.read("session-brief.json")), {
            "openItems": [{"kind": "ratchet", "path": "shop/pricing.py", "line": 12,
                           "text": "symbol_cyclomatic=14 (max 10)"}],
            "changedSymbols": [{"symbol": "shop/cart.py#Cart.total", "importers": 4},
                               {"symbol": "shop/pricing.py#apply_discount", "importers": 2}],
        })

    def test_caps_the_fragment_at_300_words_without_cutting_a_tag(self) -> None:
        self.open_pr()
        long_reply = "\n".join(f"- {'word ' * 20}line {i}. [2]" for i in range(40))

        self.run_stage(FakeModel(ModelReply(long_reply, 1, 0.0)))

        fragment = self.read_merged("taste.d/cp-1.md")
        self.assertLessEqual(len(fragment.split()), MAX_FRAGMENT_WORDS)
        self.assertTrue(all(line.endswith("}") and "{inferred cp1 fp:" in line for line in fragment.splitlines()))

    def test_makes_no_model_call_without_a_verdict_to_cite_and_still_merges(self) -> None:
        self.open_pr(verdicts=VERDICTS[3:])
        model = FakeModel(ModelReply("unused", 0, 0.0))

        report = self.run_stage(model)

        self.assertEqual((report["outcome"], report["merge"]), ("no_input", "merged"))
        self.assertEqual(model.prompts, [])
        self.assertFalse((self.workspace / ".codewatch" / "taste.d").exists())

    def test_keeps_an_earlier_fragment_when_the_model_call_fails(self) -> None:
        self.open_pr()
        (self.workspace / ".codewatch" / "taste.d").mkdir()
        (self.workspace / ".codewatch" / "taste.d" / "cp-1.md").write_text("- earlier {inferred cp1 fp:k}\n")

        report = self.run_stage(FakeModel(RuntimeError("claude exited 1")))

        self.assertEqual((report["outcome"], report["merge"]), ("model_failed", "merged"))
        self.assertEqual(self.read_merged("taste.d/cp-1.md"), "- earlier {inferred cp1 fp:k}\n")

    def test_without_graph_index_rev_reports_every_violation_and_no_changed_symbols(self) -> None:
        self.codewatch = FakeCodewatch(has_rev=False)
        self.open_pr()

        report = self.run_stage(FakeModel(ModelReply(REPLY, 1, 0.0)))

        self.assertIsNone(report["baseline"])
        self.assertIn("no `graph index --rev`", report["reason"])
        self.assertEqual(json.loads(self.read("session-brief.json"))["changedSymbols"], [])
        self.assertEqual(json.loads(self.read("audit/pr-report.json"))["deltas"], [])

    def test_without_a_hidden_repo_writes_the_fragment_and_says_why_it_did_not_merge(self) -> None:
        self.write_verdicts(VERDICTS)

        report = self.run_stage(FakeModel(ModelReply(REPLY, 1, 0.0)))

        self.assertEqual((report["outcome"], report["merge"]), ("written", "skipped"))
        self.assertIn("no hidden repository", report["reason"])
        self.assertIsNone(json.loads(self.read("audit/pr-report.json"))["check"])
        self.assertEqual(self.codewatch.calls, [])


class PromptTest(unittest.TestCase):
    def test_numbers_confirmed_then_justified_verdicts_and_lists_deltas_and_recorded_taste(self) -> None:
        listed = listed_verdicts(VERDICTS)

        prompt = build_prompt(listed, VIOLATIONS[:1], [{"symbol": "shop/cart.py#Cart.total", "importers": 4}],
                              ["- Records are dataclasses. {owner docs/style.md}"])

        self.assertIn("[1] confirmed symbol-cognitive shop/pricing.py:12: Two discount paths repeat the rounding.", prompt)
        self.assertIn("[3] justified symbol-pass-through shop/cart.py:3:", prompt)
        self.assertNotIn("unclear", prompt)
        self.assertIn("max-cc shop/pricing.py: symbol_cyclomatic=14 (max 10)", prompt)
        self.assertIn("- shop/cart.py#Cart.total (4)", prompt)
        self.assertIn("Recorded conventions:\n- Records are dataclasses. {owner docs/style.md}", prompt)

    def test_fixed_prompt_text_names_no_benchmark_metric(self) -> None:
        fixed = " ".join([SYSTEM_PROMPT, INSTRUCTIONS, build_prompt([], [], [], [])]).lower()

        for term in FORBIDDEN:
            self.assertNotIn(term, fixed)

    def test_calls_sonnet_with_no_tools_servers_or_settings(self) -> None:
        argv = claude_argv("claude-sonnet-5-5")

        self.assertEqual(argv[argv.index("--model") + 1], "claude-sonnet-5-5")
        self.assertEqual(argv[argv.index("--max-turns") + 1], "1")
        self.assertEqual(argv[argv.index("--setting-sources") + 1], "")
        self.assertIn("--strict-mcp-config", argv)
        disallowed = argv[argv.index("--disallowedTools") + 1].split(",")
        for tool in ("Bash", "Read", "Edit", "Write", "Glob", "Grep", "Task", "WebFetch", "WebSearch"):
            self.assertIn(tool, disallowed)

    def test_reads_the_other_verdicts_when_one_line_is_malformed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "verdicts.jsonl"
            path.write_text(json.dumps(VERDICTS[0]) + "\n{truncated\n" + json.dumps(VERDICTS[1]) + "\n")

            self.assertEqual(read_verdicts(path), VERDICTS[:2])

    def test_recorded_taste_is_the_head_then_other_fragments_but_not_this_prs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codewatch = Path(tmp)
            (codewatch / "taste.d").mkdir()
            (codewatch / "taste.md").write_text("- head {owner r}\n\n")
            (codewatch / "taste.d" / "cp-1.md").write_text("- one {inferred cp1 fp:a}\n")
            (codewatch / "taste.d" / "cp-2.md").write_text("- own {inferred cp2 fp:b}\n")

            self.assertEqual(recorded_taste(codewatch, "cp-2.md"), ["- head {owner r}", "- one {inferred cp1 fp:a}"])


class TasteLinesTest(unittest.TestCase):
    def test_tags_cited_lines_and_drops_the_rest(self) -> None:
        listed = [{"key": "k1"}, {"key": "k2"}]
        reply = "Intro text.\n* Keep it short. [2].\n- No cite.\n- Out of range. [3]\n- Zero. [0]"

        self.assertEqual(tagged_lines(reply, listed, 4), ["- Keep it short. {inferred cp4 fp:k2}"])

    def test_cap_keeps_whole_leading_lines(self) -> None:
        self.assertEqual(cap_lines(["a b c", "d e", "f"], limit=5), ["a b c", "d e"])
        self.assertEqual(cap_lines(["a b c", "d e f", "g"], limit=5), ["a b c"])


class PrReportTest(unittest.TestCase):
    CHECK = {"snapshot": FakeCodewatch.HEAD, "baselineSnapshot": FakeCodewatch.BASE,
             "result": {"passed": False, "newErrors": 1, "newWarnings": 0, "carryoverErrors": 1,
                        "carryoverWarnings": 0, "violations": VIOLATIONS}}
    DIFF = {"from": FakeCodewatch.BASE, "to": FakeCodewatch.HEAD, "diff": {"metricDeltas": METRIC_DELTAS}}

    def test_reports_check_deltas_and_at_most_three_questions_in_titan_platform_order(self) -> None:
        report = pr_report(self.CHECK, self.DIFF, RULES)

        self.assertEqual((report["schema"], report["head"], report["base"]), ("codewatch-pr-report@1", "a" * 40, "b" * 40))
        self.assertEqual({k: report["check"][k] for k in ("passed", "newErrors", "carryover")},
                         {"passed": False, "newErrors": 1, "carryover": 1})
        self.assertEqual([(d["path"], d["metric"], d["status"]) for d in report["deltas"]],
                         [("shop/pricing.py", "cognitive", "near-budget"), ("shop/cart.py", "loc", "new")])
        self.assertEqual(report["questions"], [
            "shop/pricing.py:12 breaks max-cc (new error): does this belong here, or should the code move?",
            "shop/pricing.py:1 cognitive is 13 against a budget of 15, was 5: should it be split before it crosses?",
            "shop/cart.py:1 is a new 300-line file: does it hold one responsibility, or should it start split?",
        ])

    def test_markdown_summarizes_the_check_and_lists_the_questions(self) -> None:
        markdown = render_markdown(pr_report(self.CHECK, self.DIFF, RULES))

        self.assertTrue(markdown.startswith("## codewatch report\n\nCheck failed: 1 new error(s), 0 new warning(s), 1 carryover.\n"
                                            f"Head `{'a' * 12}` against base `{'b' * 12}`.\n"))
        self.assertIn("### Questions\n\n- shop/pricing.py:12 breaks max-cc", markdown)

    def test_without_a_check_the_report_says_none_ran(self) -> None:
        report = pr_report(None, None, [])

        self.assertEqual((report["check"], report["deltas"], report["questions"]), (None, [], []))
        self.assertIn("No check ran.", render_markdown(report))


if __name__ == "__main__":
    unittest.main()
