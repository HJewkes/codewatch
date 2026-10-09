"""Synthesis stage tests on a Python workspace fixture, with the CLI and model mocked."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from synthesis.rubric import (
    INSTRUCTIONS,
    MAX_RUBRIC_WORDS,
    SYSTEM_PROMPT,
    ModelReply,
    build_prompt,
    cap_words,
    claude_argv,
)
from synthesis.stage import run_stage

FORBIDDEN = ("scb-check", "scb_check", "erosion", "verbosity", "grader", "grade", "slop")


def _verdict(signal: str, verdict: str, path: str, line: int, rationale: str) -> dict:
    return {"key": f"{signal}:{path}", "verdict": verdict, "rationale": rationale, "signal": signal,
            "path": path, "tool": "code-graph", "provenance": "model",
            "citations": [{"path": path, "lineStart": line, "lineEnd": line, "quote": "x"}]}


VERDICTS = [
    _verdict("symbol-cognitive", "confirmed", "shop/pricing.py", 12, "Two discount paths repeat the rounding."),
    _verdict("symbol-pass-through", "justified", "shop/cart.py", 3, "Marks the public API boundary."),
    _verdict("regnet-diff", "confirmed", "shop/cart.py", 20, "The total format changed and no spec line asks for it."),
    _verdict("clone", "confirmed", "shop/cart.py", 30, "Both copies parse a price the same way."),
]
TOP = {"snapshot": {"id": 7}, "rows": [{"nodeId": "shop/cart.py", "value": 4},
                                      {"nodeId": "shop/pricing.py", "value": 2}]}
DIFF = {"changes": [
    {"symbolId": "shop/pricing.py#apply_discount", "status": "changed", "fileId": "shop/pricing.py"},
    {"symbolId": "shop/cart.py#Cart.total", "status": "added", "fileId": "shop/cart.py"},
    {"symbolId": "shop/cart.py#old_total", "status": "removed", "fileId": "shop/cart.py"},
    {"symbolId": "shop/cli.py#main", "status": "changed", "fileId": "shop/cli.py"},
]}
CHECK = {"result": {"violations": [
    {"ruleId": "max-cc", "nodeId": "shop/pricing.py", "path": "shop/pricing.py", "lineStart": 12,
     "message": "too complex", "evidence": "symbol_cyclomatic=14 (max 10)"},
    {"ruleId": "max-cc", "nodeId": "shop/cart.py", "path": "shop/cart.py", "isCarryover": True, "message": "old"},
]}}


class FakeCli:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str]) -> str:
        self.calls.append(args)
        return json.dumps({"top": TOP, "diff": DIFF, "check": CHECK}[args[1]])


class FakeModel:
    def __init__(self, reply: ModelReply | Exception) -> None:
        self.reply = reply
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> ModelReply:
        self.prompts.append(prompt)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def _python_workspace(root: Path, *, indexed: bool = True, verdicts: list[dict] = VERDICTS) -> Path:
    (root / "shop").mkdir()
    (root / "pyproject.toml").write_text('[project]\nname = "shop"\nversion = "0.1.0"\n')
    (root / "shop" / "__init__.py").write_text("")
    (root / "shop" / "cart.py").write_text("def total(prices):\n    return sum(prices)\n")
    audit = root / ".codewatch" / "audit"
    audit.mkdir(parents=True)
    (audit / "verdicts.jsonl").write_text("".join(json.dumps(v) + "\n" for v in verdicts))
    (root / ".codewatch" / "check.json").write_text('{"rules": []}\n')
    if indexed:
        (root / ".codewatch" / "graph.db").write_bytes(b"")
    return root


class RunStageTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _brief(self) -> dict:
        return json.loads((self.root / ".codewatch" / "session-brief.json").read_text())

    def test_writes_a_capped_rubric_and_a_brief_in_fixed_order(self) -> None:
        workspace = _python_workspace(self.root)
        model = FakeModel(ModelReply(text="word " * 500, tokens=22000, usd=0.07))

        report = run_stage(workspace, FakeCli(), model)

        rubric = (workspace / ".codewatch" / "rubric.md").read_text()
        self.assertEqual(len(rubric.split()), MAX_RUBRIC_WORDS)
        brief = self._brief()
        self.assertEqual([i["kind"] for i in brief["openItems"]], ["regression", "ratchet", "quality"])
        self.assertEqual(brief["openItems"][0], {"kind": "regression", "path": "shop/cart.py", "line": 20,
                                                 "text": VERDICTS[2]["rationale"]})
        self.assertEqual(brief["openItems"][1]["text"], "symbol_cyclomatic=14 (max 10)")
        self.assertEqual(brief["changedSymbols"], [{"symbol": "shop/cart.py#Cart.total", "importers": 4},
                                                   {"symbol": "shop/pricing.py#apply_discount", "importers": 2}])
        self.assertEqual(report, {"tokens": 22000, "usd": 0.07, "items_in": 7, "items_out": 5,
                                  "outcome": "written"})
        self.assertEqual(len(model.prompts), 1)

    def test_diffs_footprints_from_the_previous_snapshot_to_the_latest(self) -> None:
        cli = FakeCli()

        run_stage(_python_workspace(self.root), cli, FakeModel(ModelReply("ok", 1, 0.0)))

        diff_call = next(c for c in cli.calls if c[1] == "diff")
        self.assertIn("--footprint", diff_call)
        self.assertEqual(diff_call[diff_call.index("--from") + 1], "previous")
        self.assertEqual(diff_call[diff_call.index("--to") + 1], "7")

    def test_makes_no_model_call_and_keeps_the_brief_empty_without_inputs(self) -> None:
        workspace = _python_workspace(self.root, indexed=False, verdicts=[])
        model = FakeModel(ModelReply("unused", 0, 0.0))

        report = run_stage(workspace, FakeCli(), model)

        self.assertEqual(report["outcome"], "no_input")
        self.assertEqual(model.prompts, [])
        self.assertEqual(self._brief(), {"openItems": [], "changedSymbols": []})
        self.assertFalse((workspace / ".codewatch" / "rubric.md").exists())

    def test_keeps_the_previous_rubric_when_the_model_call_fails(self) -> None:
        workspace = _python_workspace(self.root)
        (workspace / ".codewatch" / "rubric.md").write_text("earlier rubric\n")

        report = run_stage(workspace, FakeCli(), FakeModel(RuntimeError("claude exited 1")))

        self.assertEqual(report["outcome"], "model_failed")
        self.assertEqual((workspace / ".codewatch" / "rubric.md").read_text(), "earlier rubric\n")
        self.assertEqual(len(self._brief()["openItems"]), 3)

    def test_reads_verdicts_alone_when_the_cli_fails(self) -> None:
        def broken_cli(args: list[str]) -> str:
            raise FileNotFoundError("codewatch")

        report = run_stage(_python_workspace(self.root), broken_cli, FakeModel(ModelReply("ok", 1, 0.0)))

        self.assertEqual(report["outcome"], "written")
        self.assertEqual([i["kind"] for i in self._brief()["openItems"]], ["regression", "quality", "quality"])


class PromptTest(unittest.TestCase):
    def test_lists_confirmed_then_justified_verdicts_and_the_deltas(self) -> None:
        prompt = build_prompt(VERDICTS, CHECK["result"]["violations"][:1],
                              [{"symbol": "shop/cart.py#Cart.total", "importers": 4}])

        self.assertLess(prompt.index("confirmed clone"), prompt.index("justified symbol-pass-through"))
        self.assertIn("shop/pricing.py:12: Two discount paths repeat the rounding.", prompt)
        self.assertIn("max-cc shop/pricing.py: symbol_cyclomatic=14 (max 10)", prompt)
        self.assertIn("- shop/cart.py#Cart.total (4)", prompt)

    def test_fixed_prompt_text_names_no_benchmark_metric(self) -> None:
        fixed = " ".join([SYSTEM_PROMPT, INSTRUCTIONS, build_prompt([], [], [])]).lower()

        for term in FORBIDDEN:
            self.assertNotIn(term, fixed)

    def test_calls_sonnet_with_no_tools_servers_or_settings(self) -> None:
        argv = claude_argv("claude-sonnet-5-5")

        self.assertEqual(argv[argv.index("--model") + 1], "claude-sonnet-5-5")
        self.assertEqual(argv[argv.index("--max-turns") + 1], "1")
        self.assertEqual(argv[argv.index("--setting-sources") + 1], "")
        self.assertIn("--strict-mcp-config", argv)


class CapWordsTest(unittest.TestCase):
    def test_keeps_line_breaks_and_stops_at_the_limit(self) -> None:
        self.assertEqual(cap_words("Themes: a b\n\nFix first: c d e", limit=6),"Themes: a b\n\nFix first: c\n")

    def test_leaves_a_short_text_whole(self) -> None:
        self.assertEqual(cap_words("  short text \n"), "short text\n")


if __name__ == "__main__":
    unittest.main()
