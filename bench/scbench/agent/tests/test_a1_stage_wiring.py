"""The spec handoff to the after-solve stages, and the shipped triage and fix commands."""

import json
import os
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from agent.tests.test_claude_code_cw import TASK, FakeRuntime, SolveCapture, _build, _cw_config, _result, _solve

import yaml
from slop_code.execution.runtime import RuntimeEvent

from agent.claude_code_cw import ClaudeCodeCwAgent
from remediation.__main__ import parse_args as fix_args
from remediation.fixer import Clock
from remediation.session import run_process
from remediation.stage import remediate
from review import IMAGE_COMMAND
from tests.remediation_support import ENV, FakeClaude, FakeTools, confirmed, make_repo, write_verdicts, writes

BENCH = Path(__file__).resolve().parents[2]
IMAGE_ROOT, IMAGE_PYTHON = "/opt/codewatch-a1", "/opt/codewatch-a1/py/bin/python"
SHIPPED = yaml.safe_load((BENCH / "agent" / "claude_code_cw.yaml").read_text())["stages"]
SPEC_LINE = "The total line prints the amount in dollars with two decimal places."
REVIEW_REPLY = {"verdict": "ok", "spec_line": 1, "spec_quote": SPEC_LINE, "reason": "no output change"}


class LocalRuntime:
    """Runs each command with /bin/sh in a scratch workspace, as `docker exec` would."""

    def __init__(self, workspace, path=os.environ["PATH"], interrupt_on=None):
        self.workspace, self.path, self.interrupt_on = workspace, path, interrupt_on
        self.streamed = []

    def stream(self, command, env, timeout):
        self.streamed.append((command, dict(env)))
        if command == self.interrupt_on:
            raise KeyboardInterrupt
        done = subprocess.run(["/bin/sh", "-c", command], cwd=self.workspace, env={**env, "PATH": self.path},
                              capture_output=True, text=True, timeout=timeout, check=False)
        yield RuntimeEvent(kind="finished", result=_result(done.returncode, done.stdout))


def record(agent, stage):
    return next(r for r in agent.stage_records if r.stage == stage)


def write_script(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"#!{sys.executable}\n{body}")
    path.chmod(0o755)


class ScratchTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.workspace, self.spec_dir, self.seen = self.tmp / "workspace", self.tmp / "cw-spec", self.tmp / "seen"
        self.workspace.mkdir()
        self.seen.mkdir()
        self.enterContext(mock.patch.object(ClaudeCodeCwAgent, "spec_dir", str(self.spec_dir)))

    def files_holding_the_task(self):
        marker = TASK.splitlines()[1].encode()
        return [p for p in self.workspace.rglob("*") if p.is_file() and marker in p.read_bytes()]


class SpecFileTest(ScratchTestCase):
    def test_after_solve_stages_read_a_mode_600_spec_that_the_solve_and_the_workspace_never_see(self):
        stages = {"pr-open": {"enabled": True, "command": 'test -z "$CW_SPEC_FILE" && echo \'{"outcome": "no spec"}\''},
                  "audit": {"enabled": True, "command": "exit 3"},
                  "triage": {"enabled": True, "command": f'cp -p "$CW_SPEC_FILE" {self.seen}/'}}
        capture = SolveCapture()
        agent = _build(_cw_config(stages), LocalRuntime(self.workspace))

        _solve(agent, capture, checkpoints=2)
        agent.save_artifacts(self.tmp)
        stages_json = (self.tmp / "stages.json").read_text()

        copied = self.seen / "cp-2.md"
        self.assertEqual(copied.read_bytes(), TASK.encode())
        self.assertEqual(stat.S_IMODE(copied.stat().st_mode), 0o600)
        self.assertEqual(list(self.spec_dir.iterdir()), [])
        self.assertEqual(self.files_holding_the_task(), [])
        self.assertNotIn(TASK.splitlines()[0], stages_json)
        by_stage = {row["stage"]: row for row in json.loads(stages_json)["stages"]}
        self.assertEqual((by_stage["pr-open"]["outcome"], by_stage["audit"]["status"]), ("no spec", "failed"))
        self.assertEqual(by_stage["triage"]["status"], "ok")
        self.assertFalse(any("CW_SPEC_FILE" in env for _, env in capture.calls))

    def test_the_spec_file_is_deleted_when_a_stage_is_interrupted(self):
        stages = {"audit": {"enabled": True, "command": f'cp "$CW_SPEC_FILE" {self.seen}/'},
                  "triage": {"enabled": True, "command": "cw-interrupt"}}
        agent = _build(_cw_config(stages), LocalRuntime(self.workspace, interrupt_on="cw-interrupt"))

        with self.assertRaises(KeyboardInterrupt):
            _solve(agent, SolveCapture())

        self.assertEqual((self.seen / "cp-1.md").read_bytes(), TASK.encode())
        self.assertEqual(list(self.spec_dir.iterdir()), [])

    def test_a_spec_that_cannot_be_written_is_logged_and_the_stages_still_run(self):
        (self.tmp / "blocked").write_text("a file, not a directory\n")
        stages = {"triage": {"enabled": True, "command": 'test -f "$CW_SPEC_FILE" || echo \'{"outcome": "no file"}\''}}
        agent = _build(_cw_config(stages), LocalRuntime(self.workspace))

        with mock.patch.object(ClaudeCodeCwAgent, "spec_dir", str(self.tmp / "blocked" / "cw-spec")):
            results = _solve(agent, SolveCapture())

        self.assertFalse(results[0].had_error)
        self.assertEqual(record(agent, "triage").extra["outcome"], "no file")

    def test_with_no_after_solve_stage_to_run_no_spec_is_written(self):
        runtime = FakeRuntime()
        agent = _build(_cw_config({"pr-open": {"enabled": True, "command": "cw-pr"},
                                   "fix": {"enabled": True}}), runtime)

        _solve(agent, SolveCapture())

        self.assertEqual([c for c, _ in runtime.streamed], ["cw-pr"])


class ShippedTriageTest(ScratchTestCase):
    def test_triage_gets_the_spec_file_and_a_verdicts_fragment_named_for_the_checkpoint(self):
        bin_dir = self.tmp / "bin"
        write_script(bin_dir / "codewatch", (
            "import json, shutil, sys\n"
            "args = sys.argv[1:]\n"
            f"out = {str(self.seen)!r}\n"
            "shutil.copy(args[args.index('--spec') + 1], out + '/spec')\n"
            "open(out + '/argv', 'w').write(json.dumps(args))\n"))
        runtime = LocalRuntime(self.workspace, path=f"{bin_dir}:{os.environ['PATH']}")
        agent = _build(_cw_config({"triage": {**SHIPPED["triage"], "enabled": True}}), runtime)

        _solve(agent, SolveCapture())

        self.assertEqual(json.loads((self.seen / "argv").read_text()), [
            "triage", "/workspace", "--model", "claude-sonnet-5-5", "--spec", str(self.spec_dir / "cp-1.md"),
            "--verdicts-dir", "/workspace/.codewatch", "--run-id", "cp-1"])
        self.assertEqual((self.seen / "spec").read_bytes(), TASK.encode())
        self.assertEqual(record(agent, "triage").status, "ok")


class ShippedFixReviewTest(unittest.TestCase):
    """The shipped fix command on a real hidden repository; its review command runs for real
    against a fake `claude` that answers the one no-tools call."""

    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.root, self.prompt = self.tmp / "workspace", self.tmp / "prompt.txt"
        self.root.mkdir()
        make_repo(self.root)
        self.spec = self.tmp / "cw-spec" / "cp-2.md"
        self.spec.parent.mkdir()
        self.spec.write_text(f"{SPEC_LINE}\n")
        write_script(self.tmp / "bin" / "claude", (
            "import json, sys\n"
            f"open({str(self.prompt)!r}, 'w').write(sys.stdin.read())\n"
            f"print(json.dumps({{'result': {json.dumps(REVIEW_REPLY)!r}, 'usage': {{}}, 'total_cost_usd': 0.01}}))\n"))

    def shipped_config(self):
        argv = shlex.split(SHIPPED["fix"]["command"])
        config = fix_args([*argv[argv.index("remediation") + 1:], "--workspace", str(self.root),
                           "--scratch", str(self.tmp / "scratch")], {})
        self.assertEqual(config.review_command, [*shlex.split(IMAGE_COMMAND), "--mode", "fix"])
        local = [part.replace(IMAGE_PYTHON, sys.executable).replace(IMAGE_ROOT, str(BENCH))
                 for part in config.review_command]
        return replace(config, review_command=local)

    def run_fix_stage(self):
        fake_tools = FakeTools()

        def tools(argv, env, cwd, timeout):
            return run_process(argv, env, cwd, timeout) if argv[0] == "env" else fake_tools(argv, env, cwd, timeout)

        write_verdicts(self.root, [confirmed()])
        stage_env = {"PATH": f"{self.tmp / 'bin'}:{os.environ['PATH']}", "CW_SPEC_FILE": str(self.spec)}
        with mock.patch.dict(os.environ, stage_env):
            return remediate(self.shipped_config(), {**ENV, **stage_env},
                             FakeClaude(writes("src/app.py", "x = 3\n")), tools, Clock(None, 60))

    def test_each_fix_commit_is_reviewed_against_the_spec_and_the_verdict_reaches_stages_json(self):
        report = self.run_fix_stage()
        runtime = FakeRuntime({SHIPPED["fix"]["command"]: _result(stdout=json.dumps(report))})
        agent = _build(_cw_config({"fix": {**SHIPPED["fix"], "enabled": True}}), runtime)

        _solve(agent, SolveCapture())
        agent.save_artifacts(self.tmp)

        self.assertIn(SPEC_LINE, self.prompt.read_text())
        fix = next(r for r in json.loads((self.tmp / "stages.json").read_text())["stages"] if r["stage"] == "fix")
        self.assertEqual(fix["items"][0]["status"], "kept")
        self.assertEqual(fix["items"][0]["review"], {"verdict": "ok", "spec_line": 1, "reason": "no output change"})


if __name__ == "__main__":
    unittest.main()
