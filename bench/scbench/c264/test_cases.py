"""C-264 arm 6: the per-case gate's rejected cases leave their tables, in the replay."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from remediation.admission import Admission

from c264.cases import case_cuts, drop_rows
from c264.replay import PER_CASE, replay
from c264.test_replay import FakeCoverage, new_file_diff, write_tree

APP = "def a():\n    return 1\n\n\ndef b(x):\n    return 2 if x else 3\n"
OLD_TEST = "from app import a\n\n\ndef test_a():\n    assert a() == 1\n"
PATH = "tests/test_more.py"
INLINE = ("import pytest\nfrom app import a, b\n\n\n"
          "@pytest.mark.parametrize('x', [\n    1,  # new line\n    0,\n])\ndef test_new(x):\n    assert b(x) or a()\n")
SHARED = ("import pytest\nfrom app import a, b\n\nCASES = [\n    (1, 2),\n    (0, 3),\n]\n\n\n"
          "@pytest.mark.parametrize('x, want', CASES)\ndef test_new(x, want):\n    assert b(x) == want\n\n\n"
          "@pytest.mark.parametrize('x, want', CASES)\ndef test_dup(x, want):\n    assert a() == 1\n")
NEW, DUP = f"{PATH}::test_new", f"{PATH}::test_dup"


class FakeCaseCoverage(FakeCoverage):
    def __init__(self, reach, cases):
        super().__init__(reach)
        self.case_ids = cases

    def cases(self, test, timeout):
        return tuple(self.case_ids[test])


def run_per_case(root: Path, text: str, reach: dict, cases: dict) -> tuple[dict, Path]:
    rebuild = root / "rebuild"
    write_tree(rebuild / "base" / "demo" / "cp1", {"app.py": APP, "tests/test_app.py": OLD_TEST})
    write_tree(rebuild / "base" / "demo" / "cp2", {"app.py": APP, "tests/test_app.py": OLD_TEST, PATH: text})
    write_tree(rebuild, {"diffs/demo/cp1/01.diff": new_file_diff(PATH, text)})
    items = [{"problem": "demo", "cp": 1, "order": 1, "kind": "test-gap", "signal": "missing-test-kind",
              "symbol": "b", "diff": "diffs/demo/cp1/01.diff"}]
    (rebuild / "items.json").write_text(json.dumps(items))
    gates = lambda name, git: Admission(git, FakeCaseCoverage(reach, cases), name == PER_CASE)  # noqa: E731
    replay(PER_CASE, "demo", rebuild, root / "out", None, gates, prepare=None)
    run_dir = root / "out" / PER_CASE / "demo"
    return json.loads((run_dir / "replay.json").read_text()), run_dir / "trees"


class PerCaseArmTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def test_a_parametrized_test_keeps_its_new_line_case_and_loses_its_duplicate_case(self):
        reach = {"base": {"app.py:1", "app.py:2"}, NEW: {"app.py:5", "app.py:6"},
                 f"{NEW}[1]": {"app.py:5", "app.py:6"}, f"{NEW}[0]": {"app.py:1"}}

        log, trees = run_per_case(self.root, INLINE, reach, {NEW: [f"{NEW}[1]", f"{NEW}[0]"]})

        item = log["items"][0]
        self.assertEqual((item["status"], item["admitted"], item["rejected"]), ("trimmed", [f"{NEW}[1]"], [f"{NEW}[0]"]))
        for cp in ("cp1", "cp2"):
            kept = (trees / cp / PATH).read_text()
            self.assertEqual(kept, INLINE.replace("    0,\n", ""))

    def test_a_table_shared_by_an_admitted_and_a_rejected_test_keeps_the_admitted_tests_cases(self):
        reach = {"base": {"app.py:1", "app.py:2"}, NEW: {"app.py:5", "app.py:6"}, DUP: {"app.py:1"},
                 f"{NEW}[1-2]": {"app.py:5", "app.py:6"}, f"{NEW}[0-3]": {"app.py:5"}}

        log, trees = run_per_case(self.root, SHARED, reach, {NEW: [f"{NEW}[1-2]", f"{NEW}[0-3]"]})

        self.assertEqual(log["items"][0]["rejected"], [DUP])
        kept = (trees / "cp2" / PATH).read_text()
        self.assertIn("CASES = [\n    (1, 2),\n    (0, 3),\n]", kept)
        self.assertNotIn("def test_dup", kept)

    def test_a_shared_row_only_rejected_cases_use_goes(self):
        reach = {"base": {"app.py:1", "app.py:2"}, NEW: {"app.py:5", "app.py:6"}, DUP: {"app.py:1"},
                 f"{NEW}[1-2]": {"app.py:5", "app.py:6"}, f"{NEW}[0-3]": {"app.py:1"}}

        _, trees = run_per_case(self.root, SHARED, reach, {NEW: [f"{NEW}[1-2]", f"{NEW}[0-3]"]})

        self.assertIn("CASES = [\n    (1, 2),\n]", (trees / "cp2" / PATH).read_text())


class CaseCutsTest(unittest.TestCase):
    def test_a_table_an_unjudged_test_uses_is_left_whole(self):
        source = SHARED.replace("def test_dup", "def test_old")

        cuts = case_cuts(source, PATH, [f"{NEW}[1-2]"], [f"{NEW}[0-3]"], {NEW: [f"{NEW}[1-2]", f"{NEW}[0-3]"]})

        self.assertEqual(cuts, {})

    def test_a_table_whose_rows_the_gate_did_not_collect_one_for_one_is_left_whole(self):
        cuts = case_cuts(INLINE, PATH, [f"{NEW}[1]"], [], {NEW: [f"{NEW}[1]", f"{NEW}[0]", f"{NEW}[x]"]})

        self.assertEqual(cuts, {})

    def test_rows_on_one_line_are_cut_without_breaking_the_literal(self):
        source = "import pytest\n\n\n@pytest.mark.parametrize('x', [1, 2, 3])\ndef test_x(x):\n    pass\n"

        self.assertIn("[1]", drop_rows(source, "@test_x", {1, 2}))
        self.assertIn("[2, 3]", drop_rows(source, "@test_x", {0}))


if __name__ == "__main__":
    unittest.main()
