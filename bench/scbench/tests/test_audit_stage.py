"""The audit stage on a real hidden repository; codewatch and tiert are fakes, while diff
coverage and clones run for real from given coverage and jscpd reports."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from findings.audit_stage import audit_stage, run_tool
from tests.remediation_support import FakeClaude, FakeTools, StageTestCase, git, writes

BENCH = Path(__file__).parents[1]
FULL_HELP = "  --changed-from <ref>  ...\n  --no-ts-slop  ...\n"
APP = '''\
def covered(total):
    return total + 1


def fresh(total):
    doubled = total * 2
    return doubled
'''


def row(tool, signal, path="src/app.py"):
    return {"id": f"{tool}:{path}:1", "tool": tool, "signal": signal, "path": path, "lineStart": 1, "lineEnd": 1}


class FakeAuditTools:
    """Fakes codewatch and tiert; runs the findings modules for real, from fixed reports."""

    def __init__(self, scratch: Path, help_text=FULL_HELP, audit_exit=0):
        self.scratch, self.help_text, self.audit_exit = scratch, help_text, audit_exit
        self.calls = []

    def __call__(self, command, env, cwd):
        self.calls.append(list(command))
        findings = Path(cwd) / ".codewatch" / "audit" / "findings.jsonl"
        if command[1:] == ["audit", "--help"]:
            return subprocess.CompletedProcess(command, 0, self.help_text, "")
        if command[:2] == ["codewatch", "audit"]:
            findings.parent.mkdir(parents=True, exist_ok=True)
            findings.write_text(json.dumps(row("ruff", "F401")) + "\n")
            return subprocess.CompletedProcess(command, self.audit_exit, "", "boom" if self.audit_exit else "")
        if command[0] == "python3":
            with findings.open("a") as out:
                out.write(json.dumps(row("tiert", "symbol_assertion_free", "tests/test_app.py")) + "\n")
            return subprocess.CompletedProcess(command, 0, '{"items_out": 1}', "")
        return run_tool([*command, *self.report_args(command)], {**env, "PYTHONPATH": str(BENCH)}, cwd)

    def report_args(self, command):
        if "findings.diff_uncovered" in command:
            report = {"files": {"src/app.py": {"executed_lines": [1, 2, 5], "missing_lines": [6, 7]}}}
            return ["--coverage-json", str(self.write("coverage.json", report))]
        duplicate = {"firstFile": {"name": "src/app.py", "start": 1, "end": 2},
                     "secondFile": {"name": "src/other.py", "start": 3, "end": 4}}
        return ["--report", str(self.write("jscpd.json", {"duplicates": [duplicate]}))]

    def write(self, name, data):
        self.scratch.mkdir(parents=True, exist_ok=True)
        (self.scratch / name).write_text(json.dumps(data))
        return self.scratch / name


class AuditStageTest(StageTestCase):
    def setUp(self):
        super().setUp()
        (self.root / "src" / "app.py").write_text(APP)
        git(self.root, "commit", "-qam", "solve cp-2: add covered and fresh")
        self.tools = FakeAuditTools(self.config.scratch)

    def findings(self):
        lines = (self.root / ".codewatch" / "audit" / "findings.jsonl").read_text().splitlines()
        return [json.loads(line) for line in lines]

    def test_every_source_appends_to_the_audits_findings_against_the_merge_base_commit(self):
        merge_base = git(self.root, "merge-base", "main", "HEAD")

        report = audit_stage(self.root, self.tools)

        self.assertEqual([(r["tool"], r["signal"]) for r in self.findings()],
                         [("ruff", "F401"), ("tiert", "symbol_assertion_free"),
                          ("coverage", "diff-uncovered"), ("jscpd", "clone")])
        self.assertEqual(self.findings()[2]["symbol"], "fresh")
        self.assertIn(["codewatch", "audit", str(self.root), "--changed-from", merge_base, "--no-ts-slop"],
                      self.tools.calls)
        self.assertEqual((report["outcome"], report["merge_base"], report["items_out"]), ("ok", merge_base, 4))
        self.assertNotIn("reason", report)

    def test_a_codewatch_without_the_flags_runs_a_plain_audit(self):
        tools = FakeAuditTools(self.config.scratch, help_text="  --no-ruff  ...\n")

        audit_stage(self.root, tools)

        self.assertIn(["codewatch", "audit", str(self.root)], tools.calls)

    def test_without_a_hidden_repository_diff_coverage_is_skipped_and_named(self):
        (self.root / ".codewatch" / "repo.git" / "HEAD").unlink()

        report = audit_stage(self.root, self.tools)

        self.assertEqual([r["signal"] for r in self.findings()], ["F401", "symbol_assertion_free", "clone"])
        self.assertIn("diff coverage did not run", report["reason"])
        self.assertIsNone(report["merge_base"])

    def test_a_failed_codewatch_audit_fails_the_stage_and_runs_nothing_after_it(self):
        report = audit_stage(self.root, FakeAuditTools(self.config.scratch, audit_exit=2))

        self.assertEqual(report["outcome"], "failed")
        self.assertIn("codewatch audit exited 2: boom", report["reason"])
        self.assertEqual([r["tool"] for r in self.findings()], ["ruff"])

    def test_the_fix_stage_takes_the_diff_uncovered_row_as_its_phase_one_item(self):
        audit_stage(self.root, self.tools)

        report = self.run_stage(FakeClaude(writes("tests/test_app.py", "def test(): assert 1 == 1\n")), FakeTools())

        (item,) = report["items"]
        self.assertEqual((item["phase"], item["kind"], item["signal"]), (1, "test-gap", "diff-uncovered"))
        self.assertEqual((item["path"], item["symbol"], item["status"]), ("src/app.py", "fresh", "kept"))


class EntryPointTest(StageTestCase):
    def test_the_module_prints_its_report_as_the_last_stdout_line(self):
        only_git = self.config.scratch / "bin"
        only_git.mkdir(parents=True)
        (only_git / "git").symlink_to(shutil.which("git"))
        env = {**os.environ, "PYTHONPATH": str(BENCH), "PATH": str(only_git)}
        done = subprocess.run([sys.executable, "-P", "-m", "findings.audit_stage", "--workspace", str(self.root)],
                              env=env, capture_output=True, text=True, check=False)

        report = json.loads(done.stdout.splitlines()[-1])
        self.assertEqual((done.returncode, report["outcome"]), (1, "failed"))
        self.assertIn("codewatch is not on PATH", report["reason"])
