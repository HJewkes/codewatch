"""Which interpreter runs the fix stage's test check, by the shape of the solve's virtualenv."""

import os
import shutil
from dataclasses import replace
from pathlib import Path

from remediation.fixer import Clock
from remediation.stage import remediate
from tests.remediation_support import ENV, FakeClaude, FakeTools, StageTestCase, confirmed, write_verdicts, writes

PROBE = ["-c", "import pytest"]


class Interpreters(FakeTools):
    """Answers pytest probes and runs by whether the interpreter that `python` resolves to on
    the env's PATH, or the one named by path, has pytest; the tool pytest always has it."""

    def __init__(self, with_pytest=(), tool=None):
        super().__init__()
        self.with_pytest, self.tool = {str(p) for p in with_pytest}, str(tool) if tool else None
        self.test_runs = []

    def __call__(self, argv, env, cwd, timeout):
        argv = list(argv)
        if argv[1:] == PROBE:
            self.calls.append(argv)
            return (0 if self._which(argv[0], env) in self.with_pytest else 1), "", False
        if argv[1:3] == ["-m", "pytest"] or argv[:1] == [self.tool]:
            self.calls.append(argv)
            interpreter = self.tool if argv[0] == self.tool else self._which(argv[0], env)
            self.test_runs.append((interpreter, argv, env.get("PYTHONPATH")))
            if interpreter == self.tool or interpreter in self.with_pytest:
                return 0, "1 passed", False
            return 1, "No module named pytest", False
        return super().__call__(argv, env, cwd, timeout)

    @staticmethod
    def _which(name, env):
        if os.sep in name:
            return name
        found = (Path(d) / name for d in env.get("PATH", "").split(os.pathsep) if d)
        return next((str(p) for p in found if p.exists()), None)


class TestCheckInterpreterTest(StageTestCase):
    def setUp(self):
        super().setUp()
        system = self.root.parent / "system-bin"
        self.system_python = self._interpreter(system)
        self.env = {**ENV, "PATH": f"{system}{os.pathsep}{ENV['PATH']}"}
        self.tool = self.root.parent / "tools" / "pytest"
        write_verdicts(self.root, [confirmed("symbol_weak_oracle_only", "tests/test_app.py")])

    @staticmethod
    def _interpreter(bin_dir):
        bin_dir.mkdir(parents=True, exist_ok=True)
        (bin_dir / "python").write_bytes(b"\0")
        return bin_dir / "python"

    def _with_tool_pytest(self):
        self.tool.parent.mkdir(parents=True, exist_ok=True)
        self.tool.write_bytes(b"\0")
        return replace(self.config, tool_pytest=str(self.tool))

    def _run(self, tools, config=None):
        claude = FakeClaude(writes("tests/test_app.py", "def test(): assert 1 == 1\n"))
        return remediate(config or self.config, self.env, claude, tools, Clock(None, 60)), claude

    def test_an_empty_dot_venv_without_pytest_runs_the_check_with_the_tool_pytest(self):
        config = self._with_tool_pytest()
        tools = Interpreters(tool=self.tool)

        report, _ = self._run(tools, config)

        self.assertEqual(report["items"][0]["status"], "kept")
        base_run, item_run = tools.test_runs
        self.assertEqual(base_run, item_run)
        interpreter, argv, pythonpath = item_run
        self.assertEqual((interpreter, argv), (str(self.tool), [str(self.tool), "-q", "tests", "-rfE"]))
        self.assertEqual(pythonpath.split(os.pathsep)[0], str(self.root.resolve()))

    def test_a_venv_off_path_with_pytest_runs_the_check_with_its_python(self):
        shutil.rmtree(self.root / ".venv")
        venv_python = self._interpreter(self.root / "venv" / "bin")
        tools = Interpreters(with_pytest=[venv_python])

        report, _ = self._run(tools)

        self.assertEqual(report["items"][0]["status"], "kept")
        self.assertEqual([run[0] for run in tools.test_runs], [str(venv_python)] * 2)

    def test_a_dot_venv_with_pytest_runs_the_configured_command_with_it_on_path(self):
        venv_python = self.root / ".venv" / "bin" / "python"
        tools = Interpreters(with_pytest=[venv_python, self.system_python])

        report, _ = self._run(tools)

        self.assertEqual(report["items"][0]["status"], "kept")
        self.assertEqual(tools.test_runs, [(str(venv_python), ["python", "-m", "pytest", "-q", "tests", "-rfE"], None)] * 2)

    def test_no_runnable_pytest_reports_the_check_unavailable_before_any_fix(self):
        shutil.rmtree(self.root / ".venv")
        self._interpreter(self.root / "venv" / "bin")
        tools = Interpreters()

        report, claude = self._run(tools, replace(self.config, tool_pytest=str(self.tool)))

        self.assertEqual(report["outcome"], "check-unavailable")
        self.assertIn("no interpreter with pytest", report["reason"])
        self.assertEqual((claude.calls, tools.test_runs), ([], []))
        self.assertNotIn("items", report)
