"""The fix stage beside triage's uncommitted verdict fragment, `.codewatch/verdicts.d/cp-N.jsonl` (C-213).

Triage writes the fragment before the fix stage runs and synthesis commits it, so the fix
stage must run with it present, keep it out of its own commits and leave it on disk.
"""

import json
import unittest

from tests.remediation_support import FakeClaude, FakeTools, StageTestCase, confirmed, git, write_verdicts, writes

FRAGMENT = '{"key": "symbol-cognitive:src/app.py", "verdict": "confirmed"}\n'


class VerdictFragmentTest(StageTestCase):
    def setUp(self):
        super().setUp()
        self.fragment = self.root / ".codewatch" / "verdicts.d" / "cp-2.jsonl"
        self.fragment.parent.mkdir(parents=True)
        self.fragment.write_text(FRAGMENT)
        write_verdicts(self.root, [confirmed()])

    def test_the_fix_stage_runs_while_triage_s_fragment_is_uncommitted(self):
        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), FakeTools())

        self.assertEqual(report["outcome"], "kept", json.dumps(report))
        self.assertEqual(git(self.root, "show", "--name-only", "--format=", report["items"][0]["commit"]), "src/app.py")
        self.assertEqual(self.fragment.read_text(), FRAGMENT)
        self.assertIn("?? .codewatch/verdicts.d/", git(self.root, "status", "--porcelain"))

    def test_the_reset_at_the_time_limit_leaves_the_fragment_on_disk(self):
        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n"), timeout_on=1), FakeTools())

        self.assertEqual(report.get("stopped_by"), "time limit", json.dumps(report))
        self.assertEqual((self.root / "src" / "app.py").read_text(), "x = 2\n")
        self.assertEqual(self.fragment.read_text(), FRAGMENT)


if __name__ == "__main__":
    unittest.main()
