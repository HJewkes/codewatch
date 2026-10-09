import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from findings.diff_uncovered import main

HERE = Path(__file__).parent
PINNED_COVERAGE = os.environ.get("SCBENCH_COVERAGE", "/opt/codewatch-a1/bin/coverage")

BASE_PRICING = '''\
def discount(total):
    return total * 0.9


def surcharge(total):
    return total + 1


def untouched(total):
    return total
'''

HEAD_PRICING = '''\
def discount(total):
    """Ten percent off, never below zero."""
    return max(total * 0.9, 0)


def surcharge(total):
    if total > 100:
        return total + 2
    return total + 1


def untouched(total):
    return total
'''

TEST_PRICING = '''\
from shop.pricing import discount


def test_discount():
    assert discount(10) == 9
'''


def write(root: Path, files: dict[str, str]) -> None:
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)


def coverage_json(path: Path, executed: list[int], missing: list[int]) -> Path:
    files = {"shop/pricing.py": {"executed_lines": executed, "missing_lines": missing}}
    path.write_text(json.dumps({"meta": {"format": 3}, "files": files}))
    return path


class DiffUncoveredTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self._tmp.name)
        self.base = self.root / "base"
        self.workspace = self.root / "workspace"
        self.out = self.root / "out" / "findings.jsonl"
        write(self.base, {"shop/__init__.py": "", "shop/pricing.py": BASE_PRICING})
        write(self.workspace, {"shop/__init__.py": "", "shop/pricing.py": HEAD_PRICING,
                               "tests/test_pricing.py": TEST_PRICING})

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, *extra: str) -> dict:
        argv = ["--workspace", str(self.workspace), "--out", str(self.out), *extra]
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(main(argv), 0)
        return json.loads(stdout.getvalue().splitlines()[-1])

    def rows(self) -> list[dict]:
        return [json.loads(line) for line in self.out.read_text().splitlines()]

    def test_one_covered_and_one_uncovered_changed_function_reports_only_the_uncovered_one(self):
        report = coverage_json(self.root / "coverage.json", executed=[1, 3, 6, 12, 13], missing=[7, 8, 9])

        summary = self.run_main("--base-dir", str(self.base), "--coverage-json", str(report))

        self.assertEqual(summary["items_in"], 2)
        self.assertEqual(self.rows(), [{
            "id": "coverage:shop/pricing.py:6", "tool": "coverage", "signal": "diff-uncovered",
            "path": "shop/pricing.py", "lineStart": 6, "lineEnd": 9, "severity": "warning",
            "evidence": "surcharge changed since the baseline and no test executes lines 7-9",
            "symbol": "surcharge",
        }])

    def test_a_module_no_test_imports_reports_its_new_functions(self):
        write(self.workspace, {"shop/cart.py": "class Cart:\n    def add(self, item):\n        return item\n"})
        report = coverage_json(self.root / "coverage.json", executed=[1, 3, 6, 12, 13], missing=[7, 8, 9])

        self.run_main("--base-dir", str(self.base), "--coverage-json", str(report))

        self.assertEqual([(r["path"], r["symbol"]) for r in self.rows()],
                         [("shop/cart.py", "Cart.add"), ("shop/pricing.py", "surcharge")])

    def test_a_git_revision_baseline_counts_only_functions_changed_since_it(self):
        git = ["git", "-C", str(self.workspace), "-c", "user.name=t", "-c", "user.email=t@example.com"]
        write(self.workspace, {"shop/pricing.py": BASE_PRICING})
        subprocess.run([*git, "init", "-q"], check=True)
        subprocess.run([*git, "add", "-A"], check=True)
        subprocess.run([*git, "commit", "-qm", "base"], check=True)
        write(self.workspace, {"shop/pricing.py": HEAD_PRICING})
        report = coverage_json(self.root / "coverage.json", executed=[1, 3, 6, 12, 13], missing=[7, 8, 9])

        summary = self.run_main("--base-rev", "HEAD", "--coverage-json", str(report))

        self.assertEqual(summary, {"items_in": 2, "items_out": 1, "coverage_report": True})

    @unittest.skipUnless(Path(PINNED_COVERAGE).exists(), "needs the pinned coverage.py (A1 image or SCBENCH_COVERAGE)")
    def test_the_pytest_run_under_coverage_finds_the_untested_function(self):
        summary = self.run_main("--base-dir", str(self.base), "--coverage", PINNED_COVERAGE)

        self.assertEqual([r["symbol"] for r in self.rows()], ["surcharge"])
        self.assertTrue(summary["coverage_report"])
        self.assertFalse((self.workspace / ".coverage").exists())


if __name__ == "__main__":
    unittest.main()
