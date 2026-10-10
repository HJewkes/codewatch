"""A workspace earlier runs touched: tool output, and a second checkpoint on the same repository."""

import unittest

from tests.remediation_support import FakeClaude, FakeTools, StageTestCase, confirmed, git, \
    leave_test_run_output, next_checkpoint, write_verdicts, writes


class ToolOutputTest(StageTestCase):
    def test_a_test_gap_commit_holds_only_the_test_file_despite_bytecode_and_caches(self):
        write_verdicts(self.root, [confirmed("symbol_weak_oracle_only", "tests/test_app.py")])
        claude = FakeClaude(writes("tests/test_app.py", "def test(): assert 1 == 1\n"))

        report = self.run_stage(claude, FakeTools())

        self.assertEqual((report["outcome"], report["items"][0]["status"]), ("kept", "kept"))
        self.assertEqual(git(self.root, "show", "--name-only", "--format=", "HEAD"), "tests/test_app.py")

    def test_an_item_with_no_edit_is_unchanged_despite_bytecode_and_caches(self):
        write_verdicts(self.root, [confirmed()])

        report = self.run_stage(FakeClaude(leave_test_run_output), FakeTools())

        self.assertEqual((report["outcome"], report["items"][0]["status"]), ("unchanged", "unchanged"))
        self.assertEqual(self.log("-1"), ["solve cp-2"])
        self.assertTrue((self.root / ".venv" / "bin" / "python").exists())


class LaterCheckpointTest(StageTestCase):
    def run_backlog_item(self, text):
        write_verdicts(self.root, [confirmed("clone", "src/old.py")])
        return self.run_stage(FakeClaude(writes("src/old.py", text)), FakeTools())

    def test_a_later_checkpoint_fixes_backlog_items_beside_the_earlier_checkpoints_branches(self):
        self.run_backlog_item("y = 2\n")
        next_checkpoint(self.root, 3)

        report = self.run_backlog_item("y = 3\n")

        self.assertEqual(report["items"][0]["status"], "kept")
        self.assertEqual(self.log("-2", "--first-parent"), ["Merge cw-backlog-1-cp-3", "solve cp-3"])
        self.assertIn("cw-backlog-1-cp-2", git(self.root, "branch", "--list", "cw-backlog-*"))

    def test_a_rerun_on_the_same_checkpoint_reuses_its_backlog_branch_names(self):
        git(self.root, "branch", "cw-backlog-1-cp-2")

        report = self.run_backlog_item("y = 2\n")

        self.assertEqual(report["items"][0]["status"], "kept")

    def test_the_graph_refs_are_named_for_the_checkpoint(self):
        tools = FakeTools()
        write_verdicts(self.root, [confirmed()])

        self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), tools)

        refs = {c[c.index(flag) + 1] for c in tools.calls for flag in ("--ref", "--baseline") if flag in c}
        self.assertEqual(refs, {"cw-merge-base-cp-2", "cw-fix-cp-2"})


class CodewatchDirTest(StageTestCase):
    def test_only_the_rebuilt_parts_of_codewatch_dir_are_ignored(self):
        write_verdicts(self.root, [confirmed()])
        paths = [".codewatch/audit/verdicts.jsonl", ".codewatch/cache/graph.db",
                 ".codewatch/taste.md", ".codewatch/verdicts.jsonl", ".codewatch/verdicts.d/cp-2.jsonl"]

        self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), FakeTools())

        ignored = git(self.root, "check-ignore", "--no-index", *paths).splitlines()
        self.assertEqual(ignored, paths[:2])

if __name__ == "__main__":
    unittest.main()
