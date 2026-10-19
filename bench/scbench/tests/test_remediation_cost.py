"""The fix stage's cost report: session spend, review spend and per-model usage, with no behaviour change."""

import json
import unittest
from dataclasses import replace

from remediation.session import FixSession

from tests.remediation_support import (
    REVIEW,
    FakeClaude,
    FakeTools,
    StageTestCase,
    confirmed,
    write_verdicts,
    writes,
)

SONNET = {"inputTokens": 10, "outputTokens": 900, "cacheReadInputTokens": 20000,
          "cacheCreationInputTokens": 3000, "costUSD": 0.09}
HAIKU = {"inputTokens": 400, "outputTokens": 30, "cacheReadInputTokens": 0,
         "cacheCreationInputTokens": 0, "costUSD": 0.007}
FIRST_PROMPT = (
    "A review of this workspace confirmed some items to fix. I will send them one at a time.\n"
    "Each gives the question the reviewer answered, the answer, the evidence and a one-line\n"
    "sketch of the fix. After each item, stop; I check the change before sending the next.\n\n"
    "Rules:\n"
    "- Keep every test under tests/ passing. Run the tests before you stop.\n"
    "- Do not change what the program prints, returns or writes, unless an item says to.\n"
    "- Do not edit anything under .codewatch/.\n"
    "- Do not install packages; there is no network.\n\n"
    "Item 1 [quality] src/app.py\n"
    "Question: Is this function's complexity avoidable?\n"
    "Answer: confirmed. r\n"
    "Evidence: src/app.py:1-1\n"
    "Fix: Split or simplify the function without changing its behaviour.\n"
    "Rule for this item: Keep the behaviour the same; the full test suite must stay green.\n")
CONFLICT_PROMPT = ("A review of your last change found that it conflicts with the intended behaviour: r\n"
                   "Revise the change so the intended behaviour holds, then stop.")
HEAD = ["claude", "--output-format", "stream-json", "--verbose", "--model", "sonnet-5.5"]


def with_model_usage(claude, *per_call):
    """Wraps FakeClaude so each call's result event carries the given `modelUsage`."""
    queue = list(per_call)

    def run(argv, env, cwd, timeout):
        code, stdout, timed_out = claude(argv, env, cwd, timeout)
        return code, json.dumps({**json.loads(stdout), "modelUsage": queue.pop(0)}), timed_out
    return run


class ReviewSpendTest(StageTestCase):
    def run_conflict_then_ok(self, claude):
        write_verdicts(self.root, [confirmed()])
        tools = FakeTools(reviews=[{"verdict": "conflict", "reason": "r", "tokens": 700, "usd": 0.2},
                                   {"verdict": "ok", "tokens": 800, "usd": 0.3}])
        return self.run_stage(claude, tools), tools

    def test_each_review_calls_spend_is_kept_and_summed_into_the_stage_total(self):
        report, _ = self.run_conflict_then_ok(FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/app.py", "x = 4\n")))

        self.assertEqual(report["items"][0]["review"], {"verdict": "ok", "spec_line": None, "reason": None,
                                                        "tokens": 800, "usd": 0.3})
        self.assertEqual(report["review_tokens"], 1500)
        self.assertAlmostEqual(report["review_usd"], 0.5)
        self.assertAlmostEqual(report["usd"], 0.2)
        self.assertAlmostEqual(report["usd_total"], 0.7)

    def test_a_stage_without_reviews_reports_zero_review_spend(self):
        write_verdicts(self.root, [confirmed()])

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), FakeTools(),
                                replace(self.config, review_command=None))

        self.assertEqual((report["review_tokens"], report["review_usd"]), (0, 0.0))
        self.assertAlmostEqual(report["usd_total"], report["usd"])

    def test_the_session_argv_prompts_and_review_argv_are_unchanged(self):
        claude = FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/app.py", "x = 4\n"))

        _, tools = self.run_conflict_then_ok(claude)

        session_id = claude.calls[0][7]
        self.assertEqual(claude.calls, [
            [*HEAD, "--session-id", session_id, "--print", "--", FIRST_PROMPT],
            [*HEAD, "--resume", session_id, "--print", "--", CONFLICT_PROMPT],
        ])
        commits = [argv[1] for argv in tools.calls if argv[:1] == REVIEW]
        self.assertEqual([argv for argv in tools.calls if argv[:1] == REVIEW], [[*REVIEW, c] for c in commits])
        self.assertEqual(len(commits), 2)


class ModelUsageTest(StageTestCase):
    def test_each_calls_model_usage_is_recorded_and_totalled_per_model(self):
        write_verdicts(self.root, [confirmed()])
        claude = with_model_usage(FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/app.py", "x = 4\n")),
                                  {"claude-sonnet-5-5": SONNET, "claude-haiku-5-5": HAIKU},
                                  {"claude-sonnet-5-5": SONNET})
        tools = FakeTools(reviews=[{"verdict": "conflict", "reason": "r"}, {"verdict": "ok"}])

        report = self.run_stage(claude, tools)

        self.assertEqual(report["call_usage"], [{"claude-sonnet-5-5": SONNET, "claude-haiku-5-5": HAIKU},
                                                {"claude-sonnet-5-5": SONNET}])
        self.assertEqual(report["model_usage"]["claude-haiku-5-5"], HAIKU)
        sonnet = report["model_usage"]["claude-sonnet-5-5"]
        self.assertEqual((sonnet["outputTokens"], sonnet["cacheReadInputTokens"]), (1800, 40000))
        self.assertAlmostEqual(sonnet["costUSD"], 0.18)


class FixSessionUsageTest(unittest.TestCase):
    def test_a_result_without_model_usage_records_an_empty_call(self):
        session = FixSession({}, ".", lambda *_: (0, json.dumps({"type": "result", "total_cost_usd": 0.1}), False))

        session.ask("p", None)

        self.assertEqual((session.call_usage, session.model_usage), ([{}], {}))


if __name__ == "__main__":
    unittest.main()
