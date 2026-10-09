"""Tier T findings on hand-written fixtures, plus an opt-in linearmodels reproduction."""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tiert.cli import main
from tiert.findings import scan

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
FIXTURES = PACKAGE / "fixtures"
CONTRACT_KEYS = {"id", "tool", "signal", "path", "lineStart", "lineEnd", "symbol", "severity", "evidence"}
FLAGGED_FILE = "tests/test_flagged.py"


def _signals(rows):
    return sorted((r["signal"], r["symbol"]) for r in rows)


class CleanFixtureTest(unittest.TestCase):
    def test_well_checked_tests_give_no_findings(self):
        rows, tests = scan(FIXTURES / "clean")

        self.assertEqual(rows, [])
        self.assertEqual(tests, 8)


class FlaggedFixtureTest(unittest.TestCase):
    def setUp(self):
        self.rows, _ = scan(FIXTURES / "flagged")

    def test_each_weak_test_gets_its_signal(self):
        self.assertEqual(
            _signals(self.rows),
            [
                ("symbol_assertion_free", "test_add_smoke"),
                ("symbol_assertion_free", "test_helper_past_depth_four"),
                ("symbol_duplicate_assert", "test_repeated_check"),
                ("symbol_self_compare", "test_compares_to_itself"),
                ("symbol_weak_oracle_only", "TestCart.test_type_only"),
                ("symbol_weak_oracle_only", "test_compares_to_itself"),
                ("symbol_weak_oracle_only", "test_shape_only"),
            ],
        )

    def test_rows_carry_the_findings_contract_triage_reads(self):
        for row in self.rows:
            self.assertLessEqual(CONTRACT_KEYS, set(row))
            self.assertEqual((row["tool"], row["severity"], row["path"]), ("tier-t", "warning", FLAGGED_FILE))
        self.assertEqual(len({r["id"] for r in self.rows}), len(self.rows))

    def test_assertion_free_evidence_names_the_pytest_markers(self):
        smoke = next(r for r in self.rows if r["symbol"] == "test_add_smoke")

        self.assertTrue(smoke["evidence"].endswith("markers: smoke"))
        self.assertEqual((smoke["lineStart"], smoke["lineEnd"]), (27, 28))

    def test_duplicate_evidence_cites_both_lines(self):
        dup = next(r for r in self.rows if r["signal"] == "symbol_duplicate_assert")

        self.assertEqual(dup["evidence"], "line 49 repeats line 47: cart.total() == 0")
        self.assertEqual(dup["value"], 1)


class CliTest(unittest.TestCase):
    def test_append_keeps_existing_rows_and_reports_counts_last(self):
        with tempfile.TemporaryDirectory() as scratch:
            out = Path(scratch) / "audit" / "findings.jsonl"
            out.parent.mkdir()
            out.write_text('{"id": "existing"}\n')
            result = subprocess.run(
                [sys.executable, str(PACKAGE), str(FIXTURES / "flagged"), "--out", str(out), "--append"],
                capture_output=True, text=True, check=True,
            )
            lines = out.read_text().splitlines()

        report = json.loads(result.stdout.splitlines()[-1])
        self.assertEqual(lines[0], '{"id": "existing"}')
        self.assertEqual(len(lines), 8)
        self.assertEqual((report["items_in"], report["items_out"]), (7, 7))
        self.assertEqual(report["signals"]["symbol_assertion_free"], 2)

    def test_a_missing_root_is_an_error(self):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            code = main([str(FIXTURES / "absent")])

        self.assertEqual(code, 2)
        self.assertIn("is not a directory", err.getvalue())


@unittest.skipUnless(os.environ.get("TIERT_LINEARMODELS"), "set TIERT_LINEARMODELS to a linearmodels checkout at ec0f288906")
class LinearmodelsTest(unittest.TestCase):
    def test_reproduces_the_tier_t_research_count(self):
        rows, tests = scan(Path(os.environ["TIERT_LINEARMODELS"]))

        free = [r for r in rows if r["signal"] == "symbol_assertion_free"]
        self.assertEqual(tests, 592)
        self.assertLessEqual(abs(len(free) - 26), 2)
