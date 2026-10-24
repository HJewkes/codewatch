import tempfile
import unittest
from pathlib import Path

from agent.keep import KEPT_FILES, keep_audit_files

ROWS = {
    "findings.jsonl": '{"signal": "ERA001", "path": "src/a.py"}\n{"signal": "test-gap", "path": "src/b.py"}\n',
    "verdicts.jsonl": '{"signal": "ERA001", "path": "src/a.py", "verdict": "confirmed"}\n',
    "items.jsonl": '{"phase": 1, "path": "src/b.py"}\n{"phase": 2, "path": "src/a.py"}\n',
}


class KeepAuditFilesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.workspace = Path(tmp.name) / "workspace"
        self.audit = self.workspace / ".codewatch" / "audit"
        self.audit.mkdir(parents=True)
        self.dest = Path(tmp.name) / "checkpoint_2" / "agent"

    def test_the_findings_verdicts_and_ordered_items_land_in_the_agent_dir_unchanged(self):
        for name, text in ROWS.items():
            (self.audit / name).write_text(text)

        kept = keep_audit_files(self.workspace, self.dest)

        self.assertEqual(kept, list(KEPT_FILES))
        self.assertEqual({name: (self.dest / name).read_text() for name in KEPT_FILES}, ROWS)

    def test_a_missing_file_is_skipped_and_the_rest_are_kept(self):
        (self.audit / "findings.jsonl").write_text(ROWS["findings.jsonl"])

        kept = keep_audit_files(self.workspace, self.dest)

        self.assertEqual(kept, ["findings.jsonl"])
        self.assertEqual(sorted(p.name for p in self.dest.iterdir()), ["findings.jsonl"])

    def test_a_workspace_without_an_audit_dir_keeps_nothing(self):
        kept = keep_audit_files(self.workspace / "elsewhere", self.dest)

        self.assertEqual(kept, [])


if __name__ == "__main__":
    unittest.main()
