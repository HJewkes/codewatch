"""Test runs leave bytecode, caches and a virtualenv in the workspace; none of it is a fix."""

import unittest
from pathlib import Path

from tests.test_remediation_stage import TESTS, FakeClaude, FakeTools, StageTestCase, confirmed, git, \
    write_verdicts, writes


def leave_test_run_output(root):
    """What a real pytest run over the workspace leaves behind."""
    for path in ("src/__pycache__/app.cpython-312.pyc", "tests/__pycache__/test_app.cpython-312.pyc",
                 ".pytest_cache/v/cache/lastfailed"):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(b"\0")


class LitteringTools(FakeTools):
    def __call__(self, argv, env, cwd, timeout):
        if list(argv) == TESTS:
            leave_test_run_output(Path(cwd))
        return super().__call__(argv, env, cwd, timeout)


class ToolOutputTest(StageTestCase):
    def setUp(self):
        super().setUp()
        leave_test_run_output(self.root)
        (self.root / ".venv" / "bin").mkdir(parents=True)
        (self.root / ".venv" / "bin" / "python").write_text("")

    def test_a_test_gap_commit_stays_kept_when_test_runs_leave_bytecode_and_caches(self):
        write_verdicts(self.root, [confirmed("symbol_weak_oracle_only", "tests/test_app.py")])
        claude = FakeClaude(writes("tests/test_app.py", "def test(): assert 1 == 1\n"))

        report = self.run_stage(claude, LitteringTools())

        self.assertEqual((report["outcome"], report["items"][0]["status"]), ("kept", "kept"))
        self.assertEqual(git(self.root, "show", "--name-only", "--format=", "HEAD"), "tests/test_app.py")

    def test_an_item_with_no_edit_is_unchanged_despite_bytecode_and_caches(self):
        write_verdicts(self.root, [confirmed()])

        report = self.run_stage(FakeClaude(leave_test_run_output), LitteringTools())

        self.assertEqual((report["outcome"], report["items"][0]["status"]), ("unchanged", "unchanged"))
        self.assertEqual(self.log("-1"), ["solve cp-2"])
        self.assertTrue((self.root / ".venv" / "bin" / "python").exists())


if __name__ == "__main__":
    unittest.main()
