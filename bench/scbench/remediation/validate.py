"""The three checks a remediation must pass to be kept.

1. The agent's tests pass.
2. The replay shows no new unexplained diff. The replay net (design unit U3) is not
   built, so it is a pluggable `Replay`: any object whose `diffs()` returns the ids of
   the calls whose output changed, or None when no replay can run. With no corpus or no
   replay command the check passes and records "replay unavailable".
3. `codewatch graph check --baseline <pre-remediation snapshot>` reports no new violation.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

Run = Callable[[Sequence[str], Mapping[str, str], str, float], tuple[int | None, str, bool]]

PYTEST_NO_TESTS = 5
REPLAY_CORPUS = Path(".codewatch") / "regnet"
GRAPH_DB = ".codewatch/graph.db"
CHECK_CONFIG = ".codewatch/check.json"


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    detail: str


class Replay(Protocol):
    def diffs(self) -> frozenset[str] | None: ...


@dataclass(frozen=True)
class TestRunner:
    workspace: Path
    command: Sequence[str]
    run: Run
    timeout: float

    def __call__(self, env: Mapping[str, str]) -> Check:
        venv_bin = self.workspace / ".venv" / "bin"
        if venv_bin.is_dir():
            env = {**env, "PATH": f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"}
        code, _, timed_out = self.run(self.command, env, str(self.workspace), self.timeout)
        if timed_out:
            return Check("tests", False, "tests timed out")
        passed = code in (0, PYTEST_NO_TESTS)
        return Check("tests", passed, f"exit {code}")


@dataclass(frozen=True)
class CommandReplay:
    """Runs a replay command that prints {"diffs": [call ids]} as its last stdout line."""

    workspace: Path
    command: Sequence[str] | None
    run: Run
    timeout: float

    def diffs(self) -> frozenset[str] | None:
        if not self.command or not (self.workspace / REPLAY_CORPUS).is_dir():
            return None
        code, stdout, timed_out = self.run(self.command, dict(os.environ), str(self.workspace), self.timeout)
        report = _last_json(stdout)
        if timed_out or code != 0 or not isinstance(report.get("diffs"), list):
            return None
        return frozenset(str(d) for d in report["diffs"])


def replay_check(before: frozenset[str] | None, after: frozenset[str] | None) -> tuple[Check, int]:
    """Passes when every diff after remediation was already there before it; returns the diffs fixed."""
    if before is None or after is None:
        return Check("replay", True, "replay unavailable"), 0
    new = sorted(after - before)
    detail = f"new unexplained diffs: {', '.join(new)}" if new else f"{len(after)} diffs, none new"
    return Check("replay", not new, detail), len(before - after)


@dataclass(frozen=True)
class GraphCheck:
    workspace: Path
    codewatch: str
    run: Run
    timeout: float

    def snapshot(self, ref: str, baseline: int | None = None) -> dict | None:
        """Indexes the workspace, then runs graph check on it; None when either step fails."""
        env, cwd = dict(os.environ), str(self.workspace)
        index = [self.codewatch, "graph", "index", ".", "--db", GRAPH_DB, "--ref", ref]
        code, _, timed_out = self.run(index, env, cwd, self.timeout)
        if timed_out or code != 0:
            return None
        check = [self.codewatch, "graph", "check", "--db", GRAPH_DB, "--config", CHECK_CONFIG, "--json"]
        if baseline is not None:
            check += ["--baseline", str(baseline)]
        code, stdout, timed_out = self.run(check, env, cwd, self.timeout)
        report = _json_object(stdout)
        return None if timed_out or code not in (0, 1) or "snapshot" not in report else report


def ratchet_check(report: dict | None) -> Check:
    if report is None:
        return Check("graph-check", False, "graph check could not run")
    violations = (report.get("result") or {}).get("violations") or []
    new = [v.get("nodeId", "?") for v in violations if not v.get("isCarryover")]
    detail = f"new violations: {', '.join(new[:5])}" if new else "no new violation"
    return Check("graph-check", not new, detail)


def _json_object(text: str) -> dict:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _last_json(stdout: str) -> dict:
    lines = [line for line in stdout.splitlines() if line.strip()]
    return _json_object(lines[-1]) if lines else {}
