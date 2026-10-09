import json
import tempfile
import unittest
from pathlib import Path

from remediation.stage import Config, remediate

TESTS = ["python", "-m", "pytest", "-q", "tests"]
REPLAY = ["replay"]
ENV = {"CW_MODEL": "sonnet-5.5", "PATH": "/usr/bin"}


def result_line(cost=0.25, turns=7, subtype="success"):
    usage = {"input_tokens": 100, "output_tokens": 50, "cache_creation_input_tokens": 10,
             "cache_read_input_tokens": 40}
    return json.dumps({"type": "result", "subtype": subtype, "num_turns": turns,
                       "total_cost_usd": cost, "usage": usage})


class FakeClaude:
    """Stands in for the claude CLI: applies `edit` to the workspace and prints a result event."""

    def __init__(self, edit=None, exit_code=0, timed_out=False, stdout=None, error=None):
        self.edit, self.exit_code, self.timed_out, self.error = edit, exit_code, timed_out, error
        self.stdout = result_line() if stdout is None else stdout
        self.calls = []

    def __call__(self, argv, env, cwd, timeout):
        self.calls.append(list(argv))
        if self.edit:
            self.edit(Path(cwd))
        if self.error:
            raise self.error
        return self.exit_code, self.stdout, self.timed_out


class FakeTools:
    """Answers codewatch, the test command and the replay command by argv."""

    def __init__(self, tests=(0, 0), new_violations=(), replay=None):
        self.tests = list(tests)
        self.new_violations = list(new_violations)
        self.replay = list(replay or [])
        self.calls = []

    def __call__(self, argv, env, cwd, timeout):
        argv = list(argv)
        self.calls.append(argv)
        if argv == TESTS:
            return self.tests.pop(0), "", False
        if argv == REPLAY:
            return 0, json.dumps({"diffs": sorted(self.replay.pop(0))}), False
        if "index" in argv:
            return 0, "", False
        return self._check(argv)

    def _check(self, argv):
        baseline = "--baseline" in argv
        violations = [{"nodeId": "src/app.py", "isCarryover": True}]
        if baseline:
            violations += [{"nodeId": n, "isCarryover": False} for n in self.new_violations]
        report = {"snapshot": {"id": 8 if baseline else 7}, "result": {"violations": violations}}
        return (1 if violations else 0), json.dumps(report), False


def write_audit(root, verdicts, triage=None):
    audit = root / ".codewatch" / "audit"
    audit.mkdir(parents=True)
    (audit / "verdicts.jsonl").write_text("".join(json.dumps(v) + "\n" for v in verdicts))
    if triage is not None:
        (audit / "triage.json").write_text(json.dumps(triage))


def confirmed(signal="symbol-cognitive", path="src/app.py"):
    return {"key": "k", "signal": signal, "path": path, "verdict": "confirmed", "rationale": "r",
            "citations": [{"path": path, "lineStart": 1, "lineEnd": 2, "quote": "q"}], "controlRun": "ok"}


def edit_app(root):
    (root / "src" / "app.py").write_text("x = 2\n")
    (root / "src" / "helper.py").write_text("y = 1\n")


class RemediationStageTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "workspace"
        (self.root / "src").mkdir(parents=True)
        (self.root / "src" / "app.py").write_text("x = 1\n")
        self.config = Config(workspace=self.root, scratch=Path(tmp.name) / "scratch", codewatch="codewatch",
                             test_command=TESTS, replay_command=REPLAY, session_timeout=60, tool_timeout=60)
        write_audit(self.root, [confirmed()])

    def run_stage(self, claude, tools):
        return remediate(self.config, ENV, claude, tools)

    def test_a_validated_remediation_is_kept_and_reports_its_session(self):
        claude = FakeClaude(edit=edit_app)

        report = self.run_stage(claude, FakeTools())

        self.assertEqual(report["outcome"], "kept")
        self.assertEqual((self.root / "src" / "app.py").read_text(), "x = 2\n")
        self.assertEqual((report["items_in"], report["items_out"], report["turns"]), (1, 1, 7))
        self.assertEqual((report["tokens"], report["usd"]), (200, 0.25))
        self.assertIn(report["session_id"], claude.calls[0])
        replay = next(c for c in report["validation"] if c["name"] == "replay")
        self.assertEqual(replay["detail"], "replay unavailable")
        self.assertEqual(list((self.config.scratch).iterdir()), [])

    def test_failing_tests_discard_the_edit_and_restore_the_workspace(self):
        report = self.run_stage(FakeClaude(edit=edit_app), FakeTools(tests=(1, 1)))

        self.assertEqual(report["outcome"], "discarded")
        self.assertIn("tests: exit 1", report["reason"])
        self.assertIn("already failing before remediation", report["reason"])
        self.assertEqual((self.root / "src" / "app.py").read_text(), "x = 1\n")
        self.assertFalse((self.root / "src" / "helper.py").exists())
        self.assertEqual(report["items_out"], 0)

    def test_a_new_ratchet_violation_discards_the_edit(self):
        report = self.run_stage(FakeClaude(edit=edit_app), FakeTools(new_violations=["src/helper.py"]))

        self.assertEqual(report["outcome"], "discarded")
        self.assertIn("graph-check: new violations: src/helper.py", report["reason"])
        self.assertFalse((self.root / "src" / "helper.py").exists())

    def test_the_ratchet_compares_against_the_pre_remediation_snapshot(self):
        tools = FakeTools()

        self.run_stage(FakeClaude(), tools)

        checks = [c for c in tools.calls if "check" in c]
        self.assertNotIn("--baseline", checks[0])
        self.assertEqual(checks[1][checks[1].index("--baseline") + 1], "7")

    def test_replay_fixes_count_and_new_diffs_discard(self):
        (self.root / ".codewatch" / "regnet").mkdir()
        fixed = self.run_stage(FakeClaude(), FakeTools(replay=[{"a", "b"}, {"b"}]))
        broke = self.run_stage(FakeClaude(), FakeTools(replay=[{"a"}, {"a", "c"}]))

        self.assertEqual((fixed["outcome"], fixed["fixed_replay_diffs"]), ("kept", 1))
        self.assertEqual(broke["outcome"], "discarded")
        self.assertIn("new unexplained diffs: c", broke["reason"])

    def test_a_timed_out_session_is_discarded_without_validation(self):
        tools = FakeTools()

        report = self.run_stage(FakeClaude(edit=edit_app, exit_code=None, timed_out=True), tools)

        self.assertEqual((report["outcome"], report["reason"]), ("discarded", "session timed out"))
        self.assertFalse((self.root / "src" / "helper.py").exists())
        self.assertEqual(sum(c == TESTS for c in tools.calls), 1)

    def test_a_session_that_hits_the_turn_cap_is_still_validated(self):
        claude = FakeClaude(edit=edit_app, exit_code=1, stdout=result_line(subtype="error_max_turns"))

        report = self.run_stage(claude, FakeTools())

        self.assertEqual(report["outcome"], "kept")

    def test_an_error_mid_session_restores_the_workspace_and_propagates(self):
        claude = FakeClaude(edit=edit_app, error=KeyboardInterrupt())

        with self.assertRaises(KeyboardInterrupt):
            self.run_stage(claude, FakeTools())

        self.assertFalse((self.root / "src" / "helper.py").exists())

    def test_no_confirmed_items_skips_the_session(self):
        verdicts = self.root / ".codewatch" / "audit" / "verdicts.jsonl"
        verdicts.write_text(json.dumps({**confirmed(), "verdict": "justified"}) + "\n")
        claude = FakeClaude()

        report = self.run_stage(claude, FakeTools())

        self.assertEqual((report["outcome"], report["reason"]), ("skipped", "no confirmed items"))
        self.assertEqual(claude.calls, [])

    def test_failed_controls_send_only_regression_items(self):
        verdicts = self.root / ".codewatch" / "audit" / "verdicts.jsonl"
        verdicts.write_text("".join(json.dumps(v) + "\n" for v in [confirmed(), confirmed("regnet-diff")]))
        (verdicts.parent / "triage.json").write_text(json.dumps({"controls": {"controlRun": "provisional"}}))
        claude = FakeClaude()

        report = self.run_stage(claude, FakeTools())

        self.assertEqual((report["items_in"], report["held_back"]), (1, 1))
        self.assertIn("[regression]", claude.calls[0][-1])
        self.assertNotIn("[quality]", claude.calls[0][-1])


if __name__ == "__main__":
    unittest.main()
