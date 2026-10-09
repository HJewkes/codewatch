import re
import unittest
from pathlib import Path

from remediation.items import MAX_ITEMS, QUESTIONS, UNCOVERED_SIGNAL, select_items
from remediation.session import MAX_TURNS, claude_argv, render_prompt

TRIAGE_QUESTIONS = Path(__file__).parents[3] / "packages/cli/src/commands/triage-questions.ts"


def verdict(signal, path="src/app.py", verdict="confirmed", control_run="ok", **extra):
    citation = {"path": path, "lineStart": 3, "lineEnd": 5, "quote": "x = 1"}
    return {"key": f"{signal}:{path}", "signal": signal, "path": path, "verdict": verdict,
            "rationale": f"why {signal}", "citations": [citation], "controlRun": control_run, **extra}


def uncovered(path="src/app.py", symbol="parse"):
    return {"id": f"u:{path}", "signal": UNCOVERED_SIGNAL, "path": path, "symbol": symbol,
            "lineStart": 10, "lineEnd": 20, "evidence": "changed, no covering test", "tool": "coverage"}


class SelectItemsTest(unittest.TestCase):
    def test_items_follow_the_priority_order_and_only_confirmed_verdicts_go_in(self):
        verdicts = [verdict("symbol-cognitive"), verdict("symbol_assertion_free", "tests/test_a.py"),
                    verdict("regnet-diff"), verdict("clone", verdict="justified"),
                    verdict("symbol-pass-through", verdict="unclear")]

        items, held_back = select_items(verdicts, [uncovered()], run_provisional=False)

        self.assertEqual([i.kind for i in items], ["regression", "coverage", "weak-oracle", "quality"])
        self.assertEqual(held_back, 0)

    def test_at_most_eight_items_go_in(self):
        verdicts = [verdict("symbol-cognitive", f"src/m{n}.py") for n in range(12)]

        items, _ = select_items(verdicts, [], run_provisional=False)

        self.assertEqual(len(items), MAX_ITEMS)

    def test_failed_controls_leave_only_regression_and_coverage_items(self):
        verdicts = [verdict("regnet-diff"), verdict("symbol-cognitive"), verdict("symbol_weak_oracle_only")]

        items, held_back = select_items(verdicts, [uncovered()], run_provisional=True)

        self.assertEqual([i.kind for i in items], ["regression", "coverage"])
        self.assertEqual(held_back, 2)

    def test_a_carried_provisional_quality_verdict_is_held_back(self):
        verdicts = [verdict("symbol-cognitive", control_run="provisional"), verdict("clone", "src/b.py")]

        items, held_back = select_items(verdicts, [], run_provisional=False)

        self.assertEqual([i.signal for i in items], ["clone"])
        self.assertEqual(held_back, 1)

    def test_each_item_carries_question_verdict_citation_and_fix(self):
        items, _ = select_items([verdict("regnet-diff", citations=[
            {"path": "<spec>", "lineStart": 4, "lineEnd": 4, "quote": ""}])], [], run_provisional=False)

        item = items[0]
        self.assertTrue(item.question.startswith("Does the spec require"))
        self.assertEqual(item.verdict, "confirmed")
        self.assertEqual(item.citations, ("the specification:4-4",))
        self.assertTrue(item.fix)


class QuestionTextTest(unittest.TestCase):
    def test_question_texts_match_the_triage_questions(self):
        source = TRIAGE_QUESTIONS.read_text()
        texts = {text for signal, text in QUESTIONS.items() if signal != UNCOVERED_SIGNAL}

        missing = [text for text in texts if text not in source]

        self.assertEqual(missing, [])


class PromptTest(unittest.TestCase):
    def setUp(self):
        verdicts = [verdict("regnet-diff"), verdict("symbol-cognitive", symbol="parse")]
        self.items, _ = select_items(verdicts, [uncovered()], run_provisional=False)

    def test_the_prompt_lists_every_item_with_its_evidence_and_fix(self):
        prompt = render_prompt(self.items)

        for item in self.items:
            self.assertIn(item.question, prompt)
            self.assertIn(item.fix, prompt)
            self.assertIn(item.citations[0], prompt)
        self.assertIn("src/app.py (parse)", prompt)

    def test_the_prompt_names_no_grader_or_grader_metric(self):
        prompt = render_prompt(self.items).lower()

        self.assertIsNone(re.search(r"scb-check|scb_check|erosion|verbosity|slop|grader|score", prompt))

    def test_the_session_is_tagged_turn_capped_and_uses_the_solve_model(self):
        env = {"CW_CLAUDE_BINARY": "claude", "CW_MODEL": "sonnet-5.5", "CW_PERMISSION_MODE": "bypassPermissions"}

        argv = claude_argv(env, "sid-1", "PROMPT")

        self.assertEqual(argv[argv.index("--max-turns") + 1], str(MAX_TURNS))
        self.assertEqual(MAX_TURNS, 30)
        self.assertEqual(argv[argv.index("--model") + 1], "sonnet-5.5")
        self.assertEqual(argv[argv.index("--session-id") + 1], "sid-1")
        self.assertEqual(argv[-2:], ["--", "PROMPT"])


if __name__ == "__main__":
    unittest.main()
