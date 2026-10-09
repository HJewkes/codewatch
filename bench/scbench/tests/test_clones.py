import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from findings.clones import CONFIG, main

HERE = Path(__file__).parent
PINNED_JSCPD = os.environ.get("SCBENCH_JSCPD", "/opt/codewatch-a1/bin/jscpd")

LOADER = '''\
def {name}(path):
    rows = []
    with open(path) as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            record = json.loads(line)
            if record.get("kind") == "skip":
                continue
            rows.append({{"name": record["name"], "size": int(record.get("size", 0))}})
    rows.sort(key=lambda r: (r["size"], r["name"]))
    return rows
'''


def copy(name: str, start: int, end: int) -> dict:
    return {"name": name, "start": start, "end": end,
            "startLoc": {"line": start, "column": 1}, "endLoc": {"line": end, "column": 1}}


class ClonesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.out = self.root / "out" / "findings.jsonl"

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

    def test_each_duplicate_pair_is_one_row_naming_the_other_copy(self):
        duplicate = {"format": "python", "kind": "exact", "lines": 13, "tokens": 110,
                     "firstFile": copy("tests/test_core.py", 6, 18), "secondFile": copy("pkg/core.py", 4, 16)}
        report = self.root / "jscpd-report.json"
        report.write_text(json.dumps({"duplicates": [duplicate], "statistics": {}}))

        summary = self.run_main("--report", str(report))

        self.assertEqual(summary, {"items_in": 1, "items_out": 1, "jscpd_report": True})
        self.assertEqual(self.rows(), [{
            "id": "jscpd:tests/test_core.py:6", "tool": "jscpd", "signal": "clone",
            "path": "tests/test_core.py", "lineStart": 6, "lineEnd": 18, "severity": "warning",
            "evidence": "duplicates pkg/core.py:4-16",
        }])

    def test_a_failed_jscpd_run_reports_no_clones_even_with_an_earlier_report_left_behind(self):
        stale = self.out.parent / "jscpd" / "jscpd-report.json"
        stale.parent.mkdir(parents=True)
        duplicate = {"firstFile": copy("a.py", 1, 9), "secondFile": copy("b.py", 1, 9)}
        stale.write_text(json.dumps({"duplicates": [duplicate]}))
        failing = self.root / "jscpd"
        failing.write_text("#!/bin/sh\nexit 2\n")
        failing.chmod(0o755)

        summary = self.run_main("--jscpd", str(failing))

        self.assertEqual(summary, {"items_in": 0, "items_out": 0, "jscpd_report": False})
        self.assertEqual(self.out.read_text(), "")

    def test_the_pinned_config_uses_sixty_tokens_and_the_json_reporter(self):
        config = json.loads(CONFIG.read_text())

        self.assertEqual((config["minTokens"], config["reporters"]), (60, ["json"]))

    @unittest.skipUnless(Path(PINNED_JSCPD).exists(), "needs the pinned jscpd (A1 image or SCBENCH_JSCPD)")
    def test_jscpd_finds_a_clone_between_source_and_tests_without_writing_to_the_workspace(self):
        (self.workspace / "pkg").mkdir()
        (self.workspace / "tests").mkdir()
        (self.workspace / "pkg/core.py").write_text("import json\n\n\n" + LOADER.format(name="load_rows"))
        (self.workspace / "tests/test_core.py").write_text("import json\n\n\n" + LOADER.format(name="expected"))
        before = sorted(self.workspace.rglob("*"))

        self.run_main("--jscpd", PINNED_JSCPD)

        self.assertEqual([(r["path"], r["evidence"]) for r in self.rows()],
                         [("tests/test_core.py", "duplicates pkg/core.py:4-16")])
        self.assertEqual(sorted(self.workspace.rglob("*")), before)


if __name__ == "__main__":
    unittest.main()
