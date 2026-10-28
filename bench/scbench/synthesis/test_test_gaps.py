"""Test-gap findings stay out of the taste prompt and reach the brief only as question-worded open items."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from remediation import items as remediation
from synthesis.inputs import input_class_items
from synthesis.taste import TEST_GAP_SIGNALS, ModelReply, listed_verdicts
from synthesis.test_synthesis import VERDICTS, FakeModel, StageTestCase

CARRY_FORMAT = Path(__file__).parents[3] / "plugins/codewatch/hooks/carry-format.mjs"
MERGE_EVIDENCE = (
    "entry: main (cli)\n"
    "class: key merge, read by run_steps at etl/steps.py:7\n"
    "fed: present 1, null 1, missing 1, empty 0\n"
    "never: empty\n"
    "tests: tests/test_cli.py:14-16, tests/test_cli.py:19-20"
)


def input_class(subject: str, symbol: str = "main", evidence: str = MERGE_EVIDENCE) -> dict:
    return {"id": f"codewatch:entry-input-class:etl/cli.py#{symbol}:{subject}", "signal": "entry-input-class",
            "path": "etl/cli.py", "lineStart": 7, "lineEnd": 16, "symbol": symbol, "severity": "info",
            "tool": "codewatch", "evidence": evidence}


def test_gap(signal: str, key: str) -> dict:
    return {"key": key, "verdict": "confirmed", "signal": signal, "path": "a.py", "rationale": "no test",
            "citations": [{"path": "a.py", "lineStart": 1, "lineEnd": 1, "quote": "x"}]}


class ListedVerdictsTest(unittest.TestCase):
    def test_test_gap_verdicts_never_reach_the_taste_prompt(self) -> None:
        listed = listed_verdicts([
            {"key": "k1", "verdict": "confirmed", "signal": "missing-test-kind", "path": "a.py"},
            {"key": "k2", "verdict": "confirmed", "signal": "clone", "path": "a.py"},
            {"key": "k3", "verdict": "confirmed", "signal": "symbol_weak_oracle_only", "path": "tests/t.py"},
        ])

        self.assertEqual([r["key"] for r in listed], ["k2"])


class InputClassItemsTest(unittest.TestCase):
    def test_turns_a_finding_into_one_question_worded_open_item(self) -> None:
        items = input_class_items([input_class("key:merge")])

        self.assertEqual(items, [{
            "kind": "input-class", "path": "etl/cli.py", "line": 7,
            "text": "`main` never gets: empty for key merge (read by run_steps at etl/steps.py:7). "
                    "Do not pin a guess: check the spec or an earlier checkpoint, and if neither says, note the gap.",
        }])
        self.assertIn("check the spec", items[0]["text"])
        self.assertNotIn("pin the current", items[0]["text"])

    def test_keeps_at_most_three_per_entry_in_audit_order_and_skips_other_signals(self) -> None:
        findings = [input_class(f"key:k{i}") for i in range(5)] + [
            {**input_class("key:other"), "signal": "missing-test-kind"},
            input_class("empty:values", symbol="summarise",
                        evidence="entry: summarise (library)\nclass: empty values\nnever: empty"),
        ]

        items = input_class_items(findings)

        self.assertEqual(len(items), 4)
        self.assertEqual(items[3]["text"].split(". ")[0], "`summarise` never gets: empty for empty values")


class StageTestGapTest(StageTestCase):
    def test_makes_no_model_call_when_only_test_gap_verdicts_are_confirmed(self) -> None:
        self.open_pr(verdicts=[test_gap("missing-test-kind", "k1"), test_gap("symbol_weak_oracle_only", "k3")])
        model = FakeModel(ModelReply("- Always add a snapshot test. [1]", 1, 0.0))

        report = self.run_stage(model)

        self.assertEqual((report["outcome"], report["merge"]), ("no_input", "merged"))
        self.assertEqual(model.prompts, [])
        self.assertFalse((self.workspace / ".codewatch" / "taste.d").exists())

    def test_writes_input_class_items_into_the_brief_after_the_ratchet_items(self) -> None:
        self.open_pr(verdicts=VERDICTS)
        findings = self.workspace / ".codewatch" / "audit" / "findings.jsonl"
        findings.write_text(json.dumps(input_class("key:merge")) + "\nnot json\n")

        self.run_stage(FakeModel(ModelReply("", 1, 0.0)))

        items = json.loads(self.read("session-brief.json"))["openItems"]
        self.assertEqual([i["kind"] for i in items], ["ratchet", "input-class"])
        self.assertEqual(items[1], input_class_items([input_class("key:merge")])[0])


def carry_format_signals(source: str) -> set[str]:
    """The members of carry-format.mjs's `TEST_GAP_SIGNALS` set."""
    table = source[source.index("const TEST_GAP_SIGNALS"):]
    return set(re.findall(r'^  "([\w-]+)",$', table[:table.index("])")], flags=re.MULTILINE))


class TestGapSignalParityTest(unittest.TestCase):
    def test_synthesis_remediation_and_the_carry_hook_agree_on_test_gap_signals(self) -> None:
        self.assertEqual(TEST_GAP_SIGNALS, remediation.TEST_GAP_SIGNALS | {"entry-input-class"})
        self.assertEqual(carry_format_signals(CARRY_FORMAT.read_text()), TEST_GAP_SIGNALS)


if __name__ == "__main__":
    unittest.main()
