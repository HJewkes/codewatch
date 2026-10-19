"""The audit stage on a real hidden repository; codewatch and tiert are fakes, while diff
coverage and clones run for real from given coverage and jscpd reports."""

import io
import json
import os
import shutil
import subprocess
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from agent.stages import ExecResult, StageBudget, StageRunner, StageSetting
from findings.audit_stage import audit_stage, run_tool
from findings.audit_stage import main as audit_main

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

    def __init__(self, scratch: Path, help_text=FULL_HELP, audit_exit=0, crashes=(), tiert_paths=("tests/test_app.py",),
                 coverage_files=None):
        self.scratch, self.help_text, self.audit_exit, self.crashes = scratch, help_text, audit_exit, crashes
        self.tiert_paths = tiert_paths
        self.coverage_files = coverage_files if coverage_files is not None else {
            "src/app.py": {"executed_lines": [1, 2, 5], "missing_lines": [6, 7]}}
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
                out.writelines(json.dumps(row("tiert", "symbol_assertion_free", p)) + "\n" for p in self.tiert_paths)
            return subprocess.CompletedProcess(command, 0, '{"items_out": 1}', "")
        if any(f"findings.{name}" in command for name in self.crashes):
            return subprocess.CompletedProcess(command, 1, "", "Traceback: crashed before writing")
        return run_tool([*command, *self.report_args(command)], {**env, "PYTHONPATH": str(BENCH)}, cwd)

    def report_args(self, command):
        if "findings.diff_uncovered" in command:
            return ["--coverage-json", str(self.write("coverage.json", {"files": self.coverage_files}))]
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

    def test_rows_on_the_tasks_sample_tree_or_a_virtualenv_are_dropped_from_the_findings(self):
        for sample in ("files/A/I.py", ".venv/lib/pkg/mod.py"):
            (self.root / sample).parent.mkdir(parents=True)
            (self.root / sample).write_text("z = 1\n")
        tools = FakeAuditTools(self.config.scratch,
                               tiert_paths=("tests/test_app.py", "files/A/I.py", ".venv/lib/pkg/mod.py"))

        report = audit_stage(self.root, tools)

        self.assertEqual({r["path"] for r in self.findings() if r["tool"] == "tiert"}, {"tests/test_app.py"})
        self.assertEqual((report["dropped_ignored"], report["items_out"]), (2, 4))

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
        self.assertEqual(report["outcome"], "degraded")

    def test_a_source_that_crashes_before_writing_appends_no_earlier_checkpoints_rows(self):
        audit_stage(self.root, self.tools)

        report = audit_stage(self.root, FakeAuditTools(self.config.scratch, crashes=("diff_uncovered", "clones")))

        self.assertEqual([r["tool"] for r in self.findings()], ["ruff", "tiert"])
        self.assertIn("clones exited 1", report["reason"])

    def test_diff_coverage_without_a_coverage_report_degrades_the_stage_and_keeps_the_other_rows(self):
        tools = FakeAuditTools(self.config.scratch, coverage_files={})

        report = audit_stage(self.root, tools)

        self.assertEqual(report["outcome"], "degraded")
        self.assertIn("diff-uncovered exited 1: diff_uncovered: no coverage report", report["reason"])
        self.assertEqual([r["tool"] for r in self.findings()], ["ruff", "tiert", "jscpd"])

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


class StagesJsonTest(StageTestCase):
    """The stage runner reads the module's exit and last stdout line into its stages.json record."""

    def record(self, tools):
        def executor(command, env, timeout):
            with mock.patch("findings.audit_stage.run_tool", tools), redirect_stdout(io.StringIO()) as out:
                code = audit_main(["--workspace", str(self.root)])
            return ExecResult(code, out.getvalue(), timed_out=False)

        runner = StageRunner({"audit": StageSetting(True, "audit")}, StageBudget(0.0), executor, lambda: 1.0,
                             lambda *a, **k: None)
        runner.run(("audit",), {})
        return runner.records[0].to_json()

    def setUp(self):
        super().setUp()
        (self.root / "src" / "app.py").write_text(APP)
        git(self.root, "commit", "-qam", "solve cp-2: add covered and fresh")

    def test_a_clean_pass_is_recorded_ok_with_no_reason(self):
        record = self.record(FakeAuditTools(self.config.scratch))

        self.assertEqual((record["status"], record["exit"], record["outcome"]), ("ok", 0, "ok"))
        self.assertNotIn("reason", record)

    def test_missing_coverage_is_recorded_as_a_failed_stage_with_its_reason(self):
        record = self.record(FakeAuditTools(self.config.scratch, coverage_files={}))

        self.assertEqual((record["status"], record["exit"], record["outcome"]), ("failed", 1, "degraded"))
        self.assertIn("no coverage report the tests fully produced", record["reason"])
        self.assertEqual(record["items_out"], 3)
