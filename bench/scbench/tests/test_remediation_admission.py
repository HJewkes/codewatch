"""The admission gate for test-gap commits (C-262), on a real hidden repository."""

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from remediation.admission import judge, read_reach, test_names

from tests.remediation_support import FakeClaude, FakeTools, StageTestCase, confirmed, write_verdicts, writes

DUP, NEW = "tests/test_more.py::test_dup", "tests/test_more.py::test_new"
BOTH = "def test_dup():\n    assert 1\n\n\ndef test_new():\n    assert 2\n"
ONLY_NEW = "def test_new():\n    assert 2\n"
TABLE = "import pytest\n\n\n@pytest.mark.parametrize('x', [1, 2])\ndef test_new(x):\n    assert x\n"
NEW_ONE, NEW_TWO = f"{NEW}[1]", f"{NEW}[2]"


class AdmissionStageTest(StageTestCase):
    def setUp(self):
        super().setUp()
        write_verdicts(self.root, [confirmed("symbol_weak_oracle_only", "tests/test_app.py")])

    def test_a_duplicate_coverage_test_is_rejected_and_a_new_line_test_is_kept(self):
        tools = FakeTools(reach={"base": ["src/app.py:1"], DUP: ["src/app.py:1"],
                                 NEW: ["src/app.py:1", "src/app.py:2"]})
        claude = FakeClaude(writes("tests/test_more.py", BOTH), writes("tests/test_more.py", ONLY_NEW))

        report = self.run_stage(claude, tools)

        item = report["items"][0]
        self.assertEqual(item["status"], "kept")
        self.assertEqual(item["admission"], {"admitted": [NEW], "rejected": [DUP]})
        self.assertIn(f"they will not be kept: {DUP}.", claude.prompts()[1])
        self.assertEqual((self.root / "tests" / "test_more.py").read_text(), ONLY_NEW)
        self.assertEqual((report["tests_admitted"], report["tests_rejected"]), (1, 1))
        self.assertIn("1 new tests admitted, 1 rejected", report["reason"])
        self.assertEqual(tools.coverage.selections[0], ["tests", "--deselect", DUP, "--deselect", NEW])

    def test_a_rejected_test_the_retry_leaves_in_place_reverts_the_commit(self):
        tools = FakeTools(reach={"base": ["src/app.py:1"], DUP: ["src/app.py:1"]})
        claude = FakeClaude(writes("tests/test_more.py", "def test_dup():\n    assert 1\n"), None)

        report = self.run_stage(claude, tools)

        item = report["items"][0]
        self.assertEqual(item["status"], "reverted")
        self.assertTrue(item["cause"].startswith("admission: 1 new tests reach nothing"), item["cause"])
        self.assertFalse((self.root / "tests" / "test_more.py").exists())
        self.assertEqual((report["tests_admitted"], report["tests_rejected"]), (0, 1))
        self.assertEqual(len(claude.calls), 2)

    def test_a_parametrized_test_keeps_its_new_line_case_and_loses_its_duplicate_case(self):
        tools = FakeTools(reach={"base": ["src/app.py:1"], NEW: ["src/app.py:1", "src/app.py:2"],
                                 NEW_ONE: ["src/app.py:1", "src/app.py:2"], NEW_TWO: ["src/app.py:1"]},
                          cases={NEW: [NEW_ONE, NEW_TWO]})
        claude = FakeClaude(writes("tests/test_more.py", TABLE), writes("tests/test_more.py", TABLE.replace(", 2]", "]")))

        report = self.run_stage(claude, tools)

        self.assertEqual(report["items"][0]["admission"], {"admitted": [NEW_ONE], "rejected": [NEW_TWO]})
        self.assertIn(f"they will not be kept: {NEW_TWO}.", claude.prompts()[1])
        self.assertIn([NEW_TWO], tools.coverage.selections)

    def test_a_parametrized_test_none_of_whose_cases_reaches_new_code_is_rejected_whole(self):
        tools = FakeTools(reach={"base": ["src/app.py:1"], NEW: ["src/app.py:2"],
                                 NEW_ONE: ["src/app.py:1"], NEW_TWO: ["src/app.py:1"]},
                          cases={NEW: [NEW_ONE, NEW_TWO]})
        claude = FakeClaude(writes("tests/test_more.py", TABLE), None)

        report = self.run_stage(claude, tools)

        self.assertEqual(report["items"][0]["status"], "reverted")
        self.assertIn(f"they will not be kept: {NEW}.", claude.prompts()[1])

    def test_a_case_whose_run_reaches_nothing_fails_the_gate(self):
        tools = FakeTools(reach={"base": ["src/app.py:1"], NEW: ["src/app.py:2"], NEW_ONE: ["src/app.py:2"],
                                 NEW_TWO: []}, cases={NEW: [NEW_ONE, NEW_TWO]})

        report = self.run_stage(FakeClaude(writes("tests/test_more.py", TABLE)), tools)

        self.assertEqual(report["items"][0]["cause"], f"admission: coverage did not complete for {NEW_TWO}")

    def test_a_test_that_takes_a_branch_the_base_never_took_is_admitted_without_a_retry(self):
        tools = FakeTools(reach={"base": ["src/app.py:1", "src/app.py:1->2"],
                                 NEW: ["src/app.py:1", "src/app.py:1->3"]})
        claude = FakeClaude(writes("tests/test_more.py", ONLY_NEW))

        report = self.run_stage(claude, tools)

        self.assertEqual((report["items"][0]["status"], report["tests_admitted"]), ("kept", 1))
        self.assertEqual(len(claude.calls), 1)

    def test_a_coverage_run_that_fails_rejects_the_commit(self):
        claude = FakeClaude(writes("tests/test_more.py", ONLY_NEW))

        report = self.run_stage(claude, FakeTools(reach={"base": None}))

        item = report["items"][0]
        self.assertEqual((item["status"], item["cause"]),
                         ("reverted", "admission: coverage did not complete for the base run"))
        self.assertEqual(len(claude.calls), 1)

    def test_a_changed_existing_test_is_not_gated(self):
        tools = FakeTools()

        report = self.run_stage(FakeClaude(writes("tests/test_app.py", "def test(): assert 1 == 1\n")), tools)

        self.assertEqual(report["items"][0]["status"], "kept")
        self.assertEqual(tools.coverage.selections, [])

    def test_without_a_coverage_binary_no_test_gap_item_starts(self):
        config = replace(self.config, coverage=str(self.root / "no-coverage"))

        report = self.run_stage(FakeClaude(writes("tests/test_more.py", ONLY_NEW)), FakeTools(), config)

        self.assertEqual(report["items"][0]["status"], "not-started")
        self.assertIn("admission gate could not run", report["items"][0]["reason"])


class AdmissionRulesTest(unittest.TestCase):
    def test_a_test_is_admitted_only_for_reach_the_base_lacks(self):
        verdict = judge(frozenset({"a.py:1", "a.py:1->2"}),
                        {"t::same": frozenset({"a.py:1"}), "t::line": frozenset({"a.py:5"}),
                         "t::arc": frozenset({"a.py:1->3"}), "t::none": frozenset()})

        self.assertEqual((verdict.admitted, verdict.rejected), (("t::arc", "t::line"), ("t::none", "t::same")))

    def test_test_names_follow_pytest_collection(self):
        source = ("import unittest\n\ndef test_a(): pass\n\nasync def test_b(): pass\n\ndef helper(): pass\n\n"
                  "class TestBox:\n    def test_c(self): pass\n    def setup(self): pass\n\n"
                  "class Cases(unittest.TestCase):\n    def test_d(self): pass\n\n"
                  "class Other:\n    def test_e(self): pass\n")

        self.assertEqual(test_names(source), {"test_a", "test_b", "TestBox::test_c", "Cases::test_d"})

    def test_reach_counts_source_files_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {str(root / "src" / "a.py"): {"executed_lines": [1], "executed_branches": [[1, -1]]},
                     str(root / "tests" / "test_a.py"): {"executed_lines": [2]},
                     str(root / ".venv" / "lib.py"): {"executed_lines": [3]},
                     "b.py": {"executed_lines": [4]}}
            (root / "report.json").write_text(json.dumps({"files": files}))

            reach = read_reach(root / "report.json", root, "tests")

        self.assertEqual(reach, frozenset({"src/a.py:1", "src/a.py:1->-1", "b.py:4"}))


if __name__ == "__main__":
    unittest.main()
