"""C-264 S2 replay, on a synthetic two-checkpoint run with one test-gap commit."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from remediation.admission import Admission

from c264.replay import recorded_gates, replay

APP = "def a():\n    return 1\n\n\ndef b(x):\n    return 2 if x else 3\n"
OLD_TEST = "from app import a\n\n\ndef test_a():\n    assert a() == 1\n"
DUP_BODY = "def test_dup():\n    assert a() == 1\n"
NEW_BODY = "def test_new():\n    assert b(1) == 2\n"
MORE = f"from app import a, b\n\n\n{DUP_BODY}\n\n{NEW_BODY}"
DUP, NEW = "tests/test_more.py::test_dup", "tests/test_more.py::test_new"
HELPED = ("import os\nfrom app import a, b\n\n\ndef only_dup():\n    return os.sep\n\n\ndef shared():\n    return 1\n\n\n"
          "def test_dup():\n    assert a() == shared() and only_dup()\n\n\n"
          "def test_new():\n    assert b(shared()) == 2\n")
REACH = {"base": {"app.py:1", "app.py:2"}, DUP: {"app.py:1", "app.py:2"}, NEW: {"app.py:5", "app.py:6"}}


def new_file_diff(path: str, text: str) -> str:
    lines = text.split("\n")[:-1]
    head = f"diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n"
    return head + f"@@ -0,0 +1,{len(lines)} @@\n" + "".join(f"+{line}\n" for line in lines)


class FakeCoverage:
    """Reach by selection: the base run (the tests directory) or one test alone."""

    tests_dir = "tests"

    def __init__(self, reach: dict[str, set[str]]):
        self.reach_by = reach

    def reach(self, selection, timeout):
        return frozenset(self.reach_by["base" if selection[0] == self.tests_dir else selection[0]])


def write_tree(root: Path, files: dict[str, str]) -> None:
    for path, text in files.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text)


def write_run(root: Path, cp2_more: str = MORE, more: str = MORE) -> Path:
    """cp1's commit adds test_more.py; A1's cp2 pre-fix tree carries it forward."""
    rebuild = root / "rebuild"
    write_tree(rebuild / "base" / "demo" / "cp1", {"app.py": APP, "tests/test_app.py": OLD_TEST})
    write_tree(rebuild / "base" / "demo" / "cp2",
               {"app.py": APP, "tests/test_app.py": OLD_TEST, "tests/test_more.py": cp2_more})
    write_tree(rebuild, {"diffs/demo/cp1/01.diff": new_file_diff("tests/test_more.py", more)})
    items = [{"problem": "demo", "cp": 1, "order": 1, "kind": "test-gap", "signal": "missing-test-kind",
              "symbol": "b", "diff": "diffs/demo/cp1/01.diff"}]
    (rebuild / "items.json").write_text(json.dumps(items))
    return rebuild


def run_arm(root: Path, arm: str, rebuild: Path, gates=None) -> tuple[dict, Path]:
    gates = gates or (lambda name, git: None if name == "R-none" else Admission(git, FakeCoverage(REACH)))
    replay(arm, "demo", rebuild, root / "out", None, gates, prepare=None)
    run_dir = root / "out" / arm / "demo"
    return json.loads((run_dir / "replay.json").read_text()), run_dir / "trees"


class ReplayArmsTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.rebuild = write_run(self.root)

    def test_r_commit_drops_the_whole_commit_and_r_test_keeps_the_admitted_sibling(self):
        commit_log, commit_trees = run_arm(self.root, "R-commit", self.rebuild)
        test_log, test_trees = run_arm(self.root, "R-test", self.rebuild)

        self.assertEqual(commit_log["items"][0]["status"], "reverted")
        self.assertEqual((commit_log["items"][0]["admitted"], commit_log["items"][0]["rejected"]), ([NEW], [DUP]))
        self.assertFalse((commit_trees / "cp1" / "tests" / "test_more.py").exists())
        self.assertEqual(test_log["items"][0]["status"], "trimmed")
        kept = (test_trees / "cp1" / "tests" / "test_more.py").read_text()
        self.assertIn("def test_new", kept)
        self.assertNotIn("def test_dup", kept)

    def test_the_next_checkpoint_strips_what_the_arm_dropped_from_the_carried_tests(self):
        _, commit_trees = run_arm(self.root, "R-commit", self.rebuild)
        _, test_trees = run_arm(self.root, "R-test", self.rebuild)
        _, none_trees = run_arm(self.root, "R-none", self.rebuild)

        self.assertFalse((commit_trees / "cp2" / "tests" / "test_more.py").exists())
        self.assertEqual((test_trees / "cp2" / "tests" / "test_more.py").read_text(),
                         (test_trees / "cp1" / "tests" / "test_more.py").read_text())
        self.assertEqual((none_trees / "cp2" / "tests" / "test_more.py").read_text(), MORE)

    def test_a_rejected_test_a_later_solve_edited_survives_and_is_counted(self):
        edited = MORE.replace("assert a() == 1", "assert a() == 1, 'edited'")
        rebuild = write_run(self.root, cp2_more=edited)

        log, trees = run_arm(self.root, "R-test", rebuild)

        self.assertIn("def test_dup", (trees / "cp2" / "tests" / "test_more.py").read_text())
        self.assertEqual(log["edited_kept"], [DUP])


class HelperCutArmTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.rebuild = write_run(self.root, cp2_more=HELPED, more=HELPED)

    def test_a_helper_and_import_only_the_rejected_test_used_go_and_a_shared_helper_stays(self):
        test_log, test_trees = run_arm(self.root, "R-test", self.rebuild)
        log, trees = run_arm(self.root, "R-test+helpers", self.rebuild)

        self.assertEqual(log["items"][0]["status"], "trimmed")
        for cp in ("cp1", "cp2"):
            kept = (trees / cp / "tests" / "test_more.py").read_text()
            self.assertNotIn("def only_dup", kept)
            self.assertNotIn("import os", kept)
            self.assertIn("def shared", kept)
            self.assertIn("def test_new", kept)
            self.assertNotIn("def test_dup", kept)
            compile(kept, "test_more.py", "exec")
        self.assertIn("def only_dup", (test_trees / "cp2" / "tests" / "test_more.py").read_text())

    def test_replaying_r_test_verdicts_reproduces_the_gated_run(self):
        test_log, _ = run_arm(self.root, "R-test", self.rebuild)
        gated, gated_trees = run_arm(self.root, "R-test+helpers", self.rebuild)
        verdicts = self.root / "verdicts.json"
        verdicts.write_text(json.dumps(test_log))

        replayed, trees = run_arm(self.root, "R-test+helpers", self.rebuild, recorded_gates(verdicts))

        expected = [{k: v for k, v in i.items() if k != "gate_seconds"} for i in gated["items"]]
        self.assertEqual([{k: v for k, v in i.items() if k != "gate_seconds"} for i in replayed["items"]], expected)
        self.assertEqual((trees / "cp2" / "tests" / "test_more.py").read_text(),
                         (gated_trees / "cp2" / "tests" / "test_more.py").read_text())


if __name__ == "__main__":
    unittest.main()
