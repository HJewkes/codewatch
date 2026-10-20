"""The spec handoff to the after-solve stages, and the shipped triage, fix and solve-review commands."""

import json
import os
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from agent.tests.test_claude_code_cw import TASK, FakeRuntime, SolveCapture, _build, _cw_config, _result, _solve

import yaml
from slop_code.execution.runtime import RuntimeEvent

from agent.claude_code_cw import ClaudeCodeCwAgent
from prflow.repo import HiddenRepo

BENCH = Path(__file__).resolve().parents[2]
IMAGE_ROOT, IMAGE_PYTHON = "/opt/codewatch-a1", "/opt/codewatch-a1/py/bin/python"
SHIPPED = yaml.safe_load((BENCH / "agent" / "claude_code_cw.yaml").read_text())["stages"]


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


TRIAGE_JSON = {"cost": {"spentUsd": 22.86, "estimateUsd": 20.0}, "verdicts": {"asked": 60, "written": 58},
               "traces": [{"inputTokens": 100, "outputTokens": 20, "cacheReadInputTokens": 5000}]}


class ShippedTriageTest(ScratchTestCase):
    def run_shipped_triage(self):
        bin_dir = self.tmp / "bin"
        write_script(bin_dir / "codewatch", (
            "import json, os, shutil, sys\n"
            "args = sys.argv[1:]\n"
            f"out = {str(self.seen)!r}\n"
            "shutil.copy(args[args.index('--spec') + 1], out + '/spec')\n"
            "open(out + '/argv', 'w').write(json.dumps(args))\n"
            "os.makedirs(args[1] + '/.codewatch/audit', exist_ok=True)\n"
            f"open(args[1] + '/.codewatch/audit/triage.json', 'w').write({json.dumps(TRIAGE_JSON)!r})\n"
            "print('codewatch triage: 58 verdicts')\n"))
        local = (SHIPPED["triage"]["command"].replace(IMAGE_PYTHON, sys.executable)
                 .replace(IMAGE_ROOT, str(BENCH)).replace("/workspace", str(self.workspace)))
        runtime = LocalRuntime(self.workspace, path=f"{bin_dir}:{os.environ['PATH']}")
        agent = _build(_cw_config({"triage": {"enabled": True, "command": local}}), runtime)
        _solve(agent, SolveCapture())
        return agent

    def test_triage_gets_the_spec_file_and_a_verdicts_fragment_named_for_the_checkpoint(self):
        agent = self.run_shipped_triage()

        workspace = str(self.workspace.resolve())
        self.assertEqual(json.loads((self.seen / "argv").read_text()), [
            "triage", workspace, "--model", "claude-sonnet-5-5", "--spec", str(self.spec_dir / "cp-1.md"),
            "--verdicts-dir", f"{self.workspace}/.codewatch", "--run-id", "cp-1"])
        self.assertEqual((self.seen / "spec").read_bytes(), TASK.encode())
        self.assertEqual(record(agent, "triage").status, "ok")

    def test_the_triage_record_in_stages_json_carries_the_runs_real_spend(self):
        triage = record(self.run_shipped_triage(), "triage")

        self.assertEqual((triage.usd, triage.tokens, triage.items_in, triage.items_out), (22.86, 5120, 60, 58))


class ShippedFixStageTest(unittest.TestCase):
    def test_the_fix_stage_is_the_cleanup_runner_on_the_workspace_with_its_tree_applied(self):
        argv = shlex.split(SHIPPED["fix"]["command"])

        self.assertEqual(argv[argv.index("-m") + 1:], [
            "runner", "/workspace", "--problem", "$CW_PROBLEM", "--checkpoint", "$CW_CHECKPOINT",
            "--out", "/tmp/cw-cleanup/cp-$CW_CHECKPOINT", "--apply"])
        self.assertNotIn("remediation", SHIPPED["fix"]["command"])


GOLDEN = "tests/golden/receipt.txt"
SOLVE_ID = "solve-session-1"
SOLVE_REVIEW_REPLY = {"verdict": "conflict", "spec_line": 1, "spec_quote": TASK.splitlines()[0],
                      "reason": "The golden total lost its cents."}
# One fake `claude`: the review's no-tools call reads stdin, the solve resume restores the golden file.
FAKE_CLAUDE = """\
import json, sys
from pathlib import Path
seen = Path({seen!r})
if "--resume" in sys.argv:
    (seen / "resume.json").write_text(json.dumps(sys.argv[1:]))
    Path({golden!r}).write_text("Total: 2.50\\n")
    print(json.dumps({{"type": "result", "subtype": "success", "num_turns": 2, "total_cost_usd": 0.05,
                       "session_id": sys.argv[sys.argv.index("--resume") + 1], "usage": {{"output_tokens": 7}}}}))
else:
    (seen / "review.txt").write_text(sys.stdin.read())
    print(json.dumps({{"result": {reply!r}, "usage": {{}}, "total_cost_usd": 0.01}}))
"""


class ShippedSolveReviewTest(ScratchTestCase):
    """The shipped solve-review command, run by the agent on a real hidden repository."""

    def setUp(self):
        super().setUp()
        repo = HiddenRepo.at(self.workspace)
        repo.init()
        repo.ensure_excludes()
        (self.workspace / GOLDEN).parent.mkdir(parents=True)
        (self.workspace / GOLDEN).write_text("Total: 2.50\n")
        repo.commit_all("main")
        repo.run("switch", "-q", "-c", "cp-1")
        (self.workspace / GOLDEN).write_text("Total: 2.5\n")
        self.solve = repo.commit_all("cp-1: solve")
        self.repo = repo
        write_script(self.tmp / "bin" / "claude", FAKE_CLAUDE.format(
            seen=str(self.seen), golden=GOLDEN, reply=json.dumps(SOLVE_REVIEW_REPLY)))

    def shipped_command(self):
        command = SHIPPED["solve-review"]["command"].replace("/workspace", str(self.workspace))
        return command.replace(IMAGE_PYTHON, sys.executable).replace(IMAGE_ROOT, str(BENCH))

    def test_a_conflict_resumes_the_solve_session_once_and_stages_json_records_both_verdicts(self):
        runtime = LocalRuntime(self.workspace, path=f"{self.tmp / 'bin'}:{os.environ['PATH']}")
        agent = _build(_cw_config({"solve-review": {"enabled": True, "command": self.shipped_command()}}), runtime)
        capture = SolveCapture([{"type": "system", "subtype": "init", "session_id": SOLVE_ID}])

        _solve(agent, capture)
        agent.save_artifacts(self.tmp)
        stages_json = (self.tmp / "stages.json").read_text()

        row = next(r for r in json.loads(stages_json)["stages"] if r["stage"] == "solve-review")
        self.assertEqual((row["status"], row["verdict"], row["spec_line"], row["resumed"], row["second_verdict"]),
                         ("ok", "conflict", 1, True, "ok"))
        self.assertEqual((row["solve_commit"], row["revised_commit"]), (self.solve, self.repo.rev("HEAD")))
        resume = json.loads((self.seen / "resume.json").read_text())
        self.assertEqual(resume[resume.index("--resume") + 1], SOLVE_ID)
        self.assertIn("(specification line 1): The golden total lost its cents.", resume[-1])
        self.assertNotIn(TASK.splitlines()[1], resume[-1])
        self.assertIn(TASK.splitlines()[1], (self.seen / "review.txt").read_text())
        self.assertEqual(self.repo.run("show", f"HEAD:{GOLDEN}"), "Total: 2.50")
        self.assertEqual(self.files_holding_the_task(), [])
        self.assertFalse(any(line in stages_json for line in TASK.splitlines()))
        self.assertFalse(any("CW_SOLVE_SESSION_ID" in env for _, env in capture.calls))


if __name__ == "__main__":
    unittest.main()
