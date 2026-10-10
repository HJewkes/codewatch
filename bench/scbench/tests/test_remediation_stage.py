"""The fix stage on a real hidden repository; claude, codewatch and the reviewer are fakes."""

import stat
import unittest
from dataclasses import replace
from unittest import mock

from remediation.fixer import Clock
from remediation.git import Git
from remediation.stage import remediate
from tests.remediation_support import ENV, FakeClaude, FakeTools, StageTestCase, confirmed, git, write_verdicts, writes


class PhaseOneTest(StageTestCase):
    def test_a_test_gap_becomes_one_reviewed_commit_on_the_pr_branch(self):
        write_verdicts(self.root, [confirmed("symbol_weak_oracle_only", "tests/test_app.py")])

        report = self.run_stage(FakeClaude(writes("tests/test_app.py", "def test(): assert 1 == 1\n")), FakeTools())

        item = report["items"][0]
        self.assertEqual((report["outcome"], item["phase"], item["status"]), ("kept", 1, "kept"))
        self.assertEqual(git(self.root, "rev-parse", "HEAD"), item["commit"])
        self.assertEqual(self.log("-1"), ["codewatch fix 1: symbol_weak_oracle_only in tests/test_app.py"])
        self.assertEqual((item["review"]["verdict"], git(self.root, "branch", "--show-current")), ("ok", "cp-2"))
        self.assertEqual((item["kind"], item["missing"]), ("test-gap", None))
        self.assertEqual((report["tokens"], report["usd"], report["turns"]), (15, 0.1, 3))

    def test_a_test_gap_commit_that_edits_source_is_reverted_and_the_next_item_still_runs(self):
        write_verdicts(self.root, [confirmed("symbol_weak_oracle_only", "tests/test_app.py"),
                                   confirmed("symbol-cognitive")])
        claude = FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/app.py", "x = 4\n"))

        report = self.run_stage(claude, FakeTools())

        first, second = report["items"]
        self.assertEqual(first["status"], "reverted")
        self.assertIn("outside tests/: src/app.py", first["reason"])
        self.assertEqual(second["status"], "kept")
        self.assertIn("Your change for item 1 was reverted", claude.prompts()[1])
        self.assertTrue(self.log("-3")[1].startswith("Revert"))
        self.assertEqual((self.root / "src" / "app.py").read_text(), "x = 4\n")


class PhaseTwoTest(StageTestCase):
    def test_a_new_ratchet_violation_reverts_only_that_commit(self):
        write_verdicts(self.root, [confirmed("symbol-cognitive"), confirmed("clone")])
        claude = FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/app.py", "x = 4\n"))
        tools = FakeTools(violations=[["src/app.py#solve"], ["src/app.py#solve", "src/app.py#f"], ["src/app.py#solve"]])

        report = self.run_stage(claude, tools)

        first, second = report["items"]
        self.assertEqual(first["status"], "reverted")
        self.assertIn("graph-check: new violations: max-cc:src/app.py#f", first["reason"])
        self.assertEqual(second["status"], "kept")
        self.assertFalse(any("--rev" in c for c in tools.calls))
        check = next(c for c in tools.calls if c[1:3] == ["graph", "check"])
        self.assertEqual(check[check.index("--baseline") + 1], "cw-merge-base-cp-2")

    def test_failing_tests_revert_the_commit(self):
        write_verdicts(self.root, [confirmed()])

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), FakeTools(tests=[1]))

        self.assertEqual((report["outcome"], report["items"][0]["reason"]), ("reverted", "tests: exit 1"))
        self.assertEqual((self.root / "src" / "app.py").read_text(), "x = 2\n")

    def test_kept_commits_report_the_symbols_they_added(self):
        write_verdicts(self.root, [confirmed()])
        diff = {"addedNodes": [{"id": "src/app.py#_helper", "kind": "function", "name": "_helper"},
                               {"id": "src/app.py#Box", "kind": "class", "name": "Box"}],
                "addedEdges": [{"srcId": "src/app.py#run", "dstId": "src/app.py#_helper", "kind": "calls"}]}

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), FakeTools(diff=diff))

        expected = [{"path": "src/app.py", "name": "_helper", "flags": ["single-caller-helper"]}]
        self.assertEqual(report["added_symbols"], expected)
        self.assertEqual(report["items"][0]["added_symbols"], expected)


class PhaseThreeTest(StageTestCase):
    def test_a_finding_elsewhere_is_fixed_on_its_own_branch_and_merged(self):
        write_verdicts(self.root, [confirmed("clone", "src/old.py"), confirmed("ERA001", "src/old.py")])
        claude = FakeClaude(writes("src/old.py", "y = 2\n"), writes("src/old.py", "y = 3\n"))

        report = self.run_stage(claude, FakeTools(tests=[0, 1]))

        kept, failed = report["items"]
        self.assertEqual((kept["phase"], kept["status"], failed["status"]), (3, "kept", "reverted"))
        self.assertIn("cw-backlog-2-cp-2 not merged", failed["reason"])
        self.assertEqual(self.log("-2", "--first-parent"), ["Merge cw-backlog-1-cp-2", "solve cp-2"])
        self.assertEqual(git(self.root, "branch", "--show-current"), "cp-2")
        self.assertEqual((self.root / "src" / "old.py").read_text(), "y = 2\n")


    def test_a_test_gap_elsewhere_that_edits_source_is_reverted(self):
        write_verdicts(self.root, [confirmed("symbol_weak_oracle_only", "tests/test_old.py")])

        report = self.run_stage(FakeClaude(writes("src/old.py", "y = 2\n")), FakeTools())

        item = report["items"][0]
        self.assertEqual((item["phase"], item["status"]), (3, "reverted"))
        self.assertIn("outside tests/: src/old.py", item["reason"])
        self.assertEqual((self.root / "src" / "old.py").read_text(), "y = 1\n")


class ReviewTest(StageTestCase):
    def test_a_conflict_resumes_the_session_once_and_the_revised_commit_is_kept(self):
        write_verdicts(self.root, [confirmed()])
        claude = FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/app.py", "x = 2  # same\n"))
        tools = FakeTools(reviews=[{"verdict": "conflict", "spec_line": "7", "reason": "output changed"},
                                   {"verdict": "ok"}])

        report = self.run_stage(claude, tools)

        item = report["items"][0]
        self.assertEqual((item["status"], item["resumed"], item["review"]["verdict"]), ("kept", True, "ok"))
        self.assertIn("--resume", claude.calls[1])
        self.assertIn("specification line 7", claude.prompts()[1])
        self.assertEqual(len(self.log("main..HEAD")), 2)

    def test_a_conflict_that_stands_after_the_resume_reverts_the_commit(self):
        write_verdicts(self.root, [confirmed()])
        conflict = {"verdict": "conflict", "spec_line": None, "reason": "output changed"}

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n"), None),
                                FakeTools(reviews=[conflict, conflict]))

        self.assertEqual(report["items"][0]["status"], "reverted")
        self.assertIn("review: conflict after one resume", report["items"][0]["reason"])

    def test_without_a_review_command_the_verdict_is_recorded_as_not_configured(self):
        write_verdicts(self.root, [confirmed()])

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), FakeTools(),
                                config=replace(self.config, review_command=None))

        self.assertEqual(report["items"][0]["review"], {"verdict": "not-configured"})


class TimeLimitTest(StageTestCase):
    def test_no_item_starts_inside_the_reset_margin(self):
        write_verdicts(self.root, [confirmed(), confirmed("clone")])
        now = {"t": 0.0}

        def edit_then_wait(root):
            writes("src/app.py", "x = 3\n")(root)
            now["t"] = 950.0

        report = self.run_stage(FakeClaude(edit_then_wait), FakeTools(), clock=Clock(1000, 60, now=lambda: now["t"]))

        self.assertEqual([i["status"] for i in report["items"]], ["kept", "not-started"])
        self.assertEqual(report["stopped_by"], "time limit")

    def test_a_session_cut_off_by_the_deadline_resets_to_the_last_kept_commit(self):
        write_verdicts(self.root, [confirmed(), confirmed("clone")])
        head = git(self.root, "rev-parse", "HEAD")
        claude = FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/new.py", "z = 1\n"), timeout_on=2)

        report = self.run_stage(claude, FakeTools())

        self.assertEqual([i["status"] for i in report["items"]], ["kept", "time limit"])
        self.assertNotEqual(git(self.root, "rev-parse", "HEAD"), head)
        self.assertFalse((self.root / "src" / "new.py").exists())
        self.assertEqual(git(self.root, "status", "--porcelain"), "")


class SafetyTest(StageTestCase):
    def backups(self):
        return list(self.config.scratch.glob("remediation-*/workspace"))

    def test_an_error_resets_to_the_last_kept_commit_and_drops_the_backup(self):
        write_verdicts(self.root, [confirmed()])
        claude = FakeClaude(writes("src/app.py", "x = 9\n"), error=KeyboardInterrupt())

        with self.assertRaises(KeyboardInterrupt):
            self.run_stage(claude, FakeTools())

        self.assertEqual((self.root / "src" / "app.py").read_text(), "x = 2\n")
        self.assertEqual(self.backups(), [])

    def test_when_the_reset_and_the_restore_both_fail_the_backup_is_kept(self):
        write_verdicts(self.root, [confirmed()])
        claude = FakeClaude(writes("src/app.py", "x = 9\n"), error=KeyboardInterrupt())

        with mock.patch.object(Git, "reset_to", side_effect=RuntimeError("git gone")), \
                mock.patch("remediation.workspace.restore", side_effect=PermissionError("read-only")), \
                self.assertRaises(KeyboardInterrupt):
            self.run_stage(claude, FakeTools())

        saved = self.backups()
        self.assertEqual(len(saved), 1)
        self.assertEqual((saved[0] / "src" / "app.py").read_text(), "x = 2\n")

    def test_the_session_gives_the_owner_access_to_claude_home_again(self):
        write_verdicts(self.root, [confirmed()])
        locked = self.config.scratch.parent / "home" / ".claude" / "projects" / "trace.jsonl"
        locked.parent.mkdir(parents=True)
        locked.write_text("{}")
        locked.chmod(0o000)

        remediate(self.config, {**ENV, "HOME": str(locked.parents[2])}, FakeClaude(None), FakeTools(), Clock(None, 60))

        self.assertEqual(locked.stat().st_mode & (stat.S_IRUSR | stat.S_IWUSR), stat.S_IRUSR | stat.S_IWUSR)


class SkipTest(StageTestCase):
    def test_the_stage_skips_without_items_a_repo_a_clean_tree_or_an_outside_scratch(self):
        cases = {
            "no confirmed items": (lambda: write_verdicts(self.root, [{**confirmed(), "verdict": "justified"}]), None),
            "uncommitted changes": (lambda: (self.root / "src" / "app.py").write_text("x = 5\n"), None),
            "inside the workspace": (lambda: None, replace(self.config, scratch=self.root / "scratch")),
            "no hidden repository": (lambda: None, replace(self.config, git_dir=self.root / "missing.git")),
        }
        for reason, (arrange, config) in cases.items():
            with self.subTest(reason):
                write_verdicts(self.root, [confirmed()])
                arrange()
                claude = FakeClaude()
                report = self.run_stage(claude, FakeTools(), config=config)
                git(self.root, "checkout", "--", ".")
                self.assertEqual(report["outcome"], "skipped")
                self.assertIn(reason, report["reason"])
                self.assertEqual(claude.calls, [])


if __name__ == "__main__":
    unittest.main()
