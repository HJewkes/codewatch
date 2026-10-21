"""--apply: the A1 fix stage's write-back of the cleanup run's final tree over /workspace (C-248 S7)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from runner.__main__ import apply


def write(root: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)


class ApplyTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.frozen, self.final = tmp / "workspace", tmp / "final"
        write(self.frozen, {"app.py": "x = 1\n", "old.py": "y = 2\n", "same.py": "z = 3\n", ".git/HEAD": "ref\n"})
        write(self.final, {"app.py": "x = 2\n", "new.py": "w = 4\n", "same.py": "z = 3\n"})

    def test_the_workspace_gets_the_final_trees_edits_additions_and_deletions(self):
        changed = apply(self.frozen, self.final)

        self.assertEqual(changed, ["app.py", "new.py", "old.py"])
        self.assertEqual((self.frozen / "app.py").read_text(), "x = 2\n")
        self.assertEqual((self.frozen / "new.py").read_text(), "w = 4\n")
        self.assertFalse((self.frozen / "old.py").exists())

    def test_skipped_directories_such_as_git_are_left_alone(self):
        apply(self.frozen, self.final)

        self.assertEqual((self.frozen / ".git" / "HEAD").read_text(), "ref\n")

    def test_an_unchanged_final_tree_changes_nothing(self):
        self.assertEqual(apply(self.frozen, self.frozen), [])


if __name__ == "__main__":
    unittest.main()
