"""Which interpreter runs the fix stage's test check.

The default check is `python -m pytest`, so it needs a `python` that imports pytest. The
solve's virtualenv comes first (`.venv`, then `venv`), then the `python` on PATH. A solve
that tests with unittest can leave a virtualenv without pytest, or one off PATH, so the last
resort is the image's pinned pytest, the one the audit's diff coverage runs. It gets the
workspace and the solve's virtualenv packages on `PYTHONPATH`, as `python -m pytest` in that
virtualenv would see them. A custom test command runs as given, with `.venv/bin` on PATH.

`prefix` counts the argv entries that invoke pytest, so the check can ask pytest for its
short summary and rerun single tests; it is 0 for a custom command, judged by exit code.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from findings.diff_uncovered import AGENT_VENVS, agent_site_hook

from .session import Run

DEFAULT_TOOL_PYTEST = "/opt/codewatch-a1/bin/pytest"
PYTHON_NAMES = ("python", "python3")
PYTEST_MODULE = ["-m", "pytest"]
PROBE = ["-c", "import pytest"]
SUMMARY_FLAGS = ("-rfE",)
STOP_EARLY = ("-x", "--exitfirst", "--maxfail")


@dataclass(frozen=True)
class TestCommand:
    command: tuple[str, ...]
    source: str
    path: tuple[str, ...] = ()
    pythonpath: str | None = None
    prefix: int = 0

    def argv(self) -> list[str]:
        return [*self.command, *SUMMARY_FLAGS] if self.prefix else list(self.command)

    def stop_early_option(self) -> str | None:
        """A pytest option that ends the run at a failure, so the run names only some of them."""
        options = self.command[self.prefix:] if self.prefix else ()
        return next((a for a in options if a.split("=")[0] in STOP_EARLY), None)

    def rerun_argv(self, test_ids: Sequence[str]) -> list[str]:
        """Only the named tests; the command's own options and paths are left out."""
        return [*self.command[:self.prefix], "-q", *SUMMARY_FLAGS, *test_ids]

    def env(self, base: Mapping[str, str]) -> dict[str, str]:
        env = dict(base)
        if self.path:
            env["PATH"] = os.pathsep.join([*self.path, base.get("PATH", "")])
        if self.pythonpath:
            env["PYTHONPATH"] = self.pythonpath
        return env


@dataclass(frozen=True)
class Resolver:
    workspace: Path
    tool_pytest: str
    scratch: Path
    run: Run

    def __call__(self, command: Sequence[str], env: Mapping[str, str], timeout: float | None) -> TestCommand | None:
        """The command that can run the tests, or None when no interpreter has pytest."""
        if Path(command[0]).name not in PYTHON_NAMES or list(command[1:3]) != PYTEST_MODULE:
            dot_venv = self.workspace / ".venv" / "bin"
            return TestCommand(tuple(command), "custom", (str(dot_venv),) if dot_venv.is_dir() else ())
        for venv in self._venv_bins():
            if self._has_pytest(str(venv / "python"), env, timeout):
                return TestCommand(tuple(command), venv.parent.name, (str(venv),), prefix=3)
        if self._has_pytest(command[0], env, timeout):
            return TestCommand(tuple(command), "PATH", prefix=3)
        if not Path(self.tool_pytest).is_file():
            return None
        root = self.workspace.resolve()
        pythonpath = os.pathsep.join([str(root), str(agent_site_hook(root, self.scratch / "test-env"))])
        bins = tuple(str(b) for b in self._venv_bins())
        return TestCommand((self.tool_pytest, *command[3:]), "tool pytest", bins, pythonpath, prefix=1)

    def _venv_bins(self) -> list[Path]:
        return [self.workspace / v / "bin" for v in AGENT_VENVS if (self.workspace / v / "bin" / "python").exists()]

    def _has_pytest(self, python: str, env: Mapping[str, str], timeout: float | None) -> bool:
        code, _, timed_out = self.run([python, *PROBE], env, str(self.workspace), timeout)
        return code == 0 and not timed_out
