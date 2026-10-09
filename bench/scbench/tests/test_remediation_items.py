import re
import unittest
from pathlib import Path

from remediation.__main__ import parse_args
from remediation.items import MISSING_TEST_KIND, QUESTIONS, UNCOVERED_SIGNAL, select_items
from remediation.session import claude_argv, first_prompt, render_item

TRIAGE_QUESTIONS = Path(__file__).parents[3] / "packages/cli/src/commands/triage-questions.ts"
# Asked by units not merged yet: diff-uncovered is measured (U5), missing-test-kind arrives with U7b.
NOT_IN_TRIAGE_YET = {UNCOVERED_SIGNAL, MISSING_TEST_KIND}
CHANGED = {"src/app.py", "tests/test_app.py"}


def verdict(signal, path="src/app.py", verdict="confirmed", control_run="ok", **extra):
    citation = {"path": path, "lineStart": 3, "lineEnd": 5, "quote": "x = 1"}
    return {"key": f"{signal}:{path}", "signal": signal, "path": path, "verdict": verdict,
            "rationale": f"why {signal}", "citations": [citation], "controlRun": control_run, **extra}


def uncovered(path="src/app.py", symbol="parse"):
    return {"id": f"u:{path}", "signal": UNCOVERED_SIGNAL, "path": path, "symbol": symbol,
            "lineStart": 10, "lineEnd": 20, "evidence": "changed, no covering test", "tool": "coverage"}


class SelectItemsTest(unittest.TestCase):
    def test_items_come_in_phase_order_and_only_confirmed_verdicts_go_in(self):
        verdicts = [verdict("clone", "src/old.py"), verdict("symbol-cognitive"),
                    verdict("symbol_assertion_free", "tests/test_old.py"),
                    verdict(MISSING_TEST_KIND), verdict("symbol_assertion_free", "tests/test_app.py"),
                    verdict("symbol-pass-through", verdict="justified")]

        items, held_back = select_items(verdicts, [uncovered()], CHANGED, run_provisional=False)

        self.assertEqual([(i.phase, i.signal, i.path) for i in items], [
            (1, MISSING_TEST_KIND, "src/app.py"), (1, "symbol_assertion_free", "tests/test_app.py"),
            (1, UNCOVERED_SIGNAL, "src/app.py"), (2, "symbol-cognitive", "src/app.py"),
            (3, "symbol_assertion_free", "tests/test_old.py"), (3, "clone", "src/old.py")])
        self.assertEqual(held_back, 0)

    def test_there_is_no_item_cap_unless_one_is_asked_for(self):
        verdicts = [verdict("symbol-cognitive", f"src/m{n}.py") for n in range(40)]

        uncapped, _ = select_items(verdicts, [], CHANGED, run_provisional=False)
        capped, _ = select_items(verdicts, [], CHANGED, run_provisional=False, limit=3)

        self.assertEqual((len(uncapped), len(capped)), (40, 3))

    def test_failed_controls_hold_back_quality_items_only(self):
        verdicts = [verdict("symbol-cognitive"), verdict("clone", "src/old.py"),
                    verdict("symbol_weak_oracle_only", "tests/test_app.py")]

        items, held_back = select_items(verdicts, [uncovered()], CHANGED, run_provisional=True)

        self.assertEqual({i.kind for i in items}, {"test-gap"})
        self.assertEqual((len(items), held_back), (2, 2))

    def test_a_carried_provisional_quality_verdict_is_held_back(self):
        verdicts = [verdict("symbol-cognitive", control_run="provisional"), verdict("clone")]

        items, held_back = select_items(verdicts, [], CHANGED, run_provisional=False)

        self.assertEqual(([i.signal for i in items], held_back), (["clone"], 1))

    def test_each_item_carries_question_verdict_citation_and_fix(self):
        items, _ = select_items([verdict("clone", citations=[
            {"path": "<spec>", "lineStart": 4, "lineEnd": 4, "quote": ""}])], [], CHANGED, False)

        item = items[0]
        self.assertEqual((item.question, item.verdict), (QUESTIONS["clone"], "confirmed"))
        self.assertEqual(item.citations, ("the specification:4-4",))
        self.assertTrue(item.fix)


class QuestionTextTest(unittest.TestCase):
    def test_question_texts_match_the_triage_questions(self):
        source = TRIAGE_QUESTIONS.read_text()
        texts = {text for signal, text in QUESTIONS.items() if signal not in NOT_IN_TRIAGE_YET}

        self.assertEqual([text for text in texts if text not in source], [])


class PromptTest(unittest.TestCase):
    def setUp(self):
        verdicts = [verdict("symbol-cognitive", symbol="parse"), verdict("clone", "src/old.py")]
        self.items, _ = select_items(verdicts, [uncovered()], CHANGED, run_provisional=False)

    def test_each_item_prompt_carries_its_evidence_fix_and_phase_rule(self):
        for n, item in enumerate(self.items, start=1):
            text = render_item(n, item, feedback="Your change for item 0 was reverted.")
            self.assertIn(item.question, text)
            self.assertIn(item.fix, text)
            self.assertIn(item.citations[0], text)
            self.assertTrue(text.startswith("Your change for item 0 was reverted."))
        self.assertIn("change no other file", render_item(1, self.items[0]))

    def test_the_prompts_name_no_grader_or_grader_metric(self):
        text = first_prompt("\n".join(render_item(n, i) for n, i in enumerate(self.items))).lower()

        self.assertIsNone(re.search(r"scb-check|scb_check|erosion|verbosity|slop|grader|score", text))

    def test_the_session_has_no_turn_cap_unless_one_is_asked_for(self):
        env = {"CW_CLAUDE_BINARY": "claude", "CW_MODEL": "sonnet-5.5", "CW_PERMISSION_MODE": "bypassPermissions"}

        first = claude_argv(env, "sid-1", "PROMPT", resume=False)
        capped = claude_argv(env, "sid-1", "PROMPT", resume=True, max_turns=12)

        self.assertNotIn("--max-turns", first)
        self.assertEqual(first[first.index("--session-id") + 1], "sid-1")
        self.assertEqual(first[first.index("--model") + 1], "sonnet-5.5")
        self.assertEqual(capped[capped.index("--max-turns") + 1], "12")
        self.assertEqual(capped[capped.index("--resume") + 1], "sid-1")
        self.assertEqual(first[-2:], ["--", "PROMPT"])


class CommandLineTest(unittest.TestCase):
    def test_no_cap_has_a_default_and_the_deadline_comes_from_the_agent(self):
        config = parse_args(["--workspace", "."], {"CW_DEADLINE": "1700000000"})

        self.assertEqual((config.max_items, config.max_turns), (None, None))
        self.assertEqual(config.deadline, 1_700_000_000.0)
        self.assertIsNone(config.review_command)
        self.assertEqual(list(config.test_command), ["python", "-m", "pytest", "-q", "tests"])


if __name__ == "__main__":
    unittest.main()
