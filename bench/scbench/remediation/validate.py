"""Checks on each fix commit, and the hook for the spec-aware commit review (U17).

- Tests: the agent's whole suite is green.
- Ratchet: `codewatch graph check --baseline <merge-base>` lists no violation the tree
  before the commit did not already have. The solve's own new violations are not the
  fix's, so the comparison is against the state before the commit.
- Added symbols: functions and methods the commit added, flagged `single-caller-helper`
  when exactly one `calls` edge reaches them (the U11 gaming check reads these).
- Review: an optional command that gets the commit sha and prints
  `{"verdict": "ok"|"conflict", "spec_line": ..., "reason": ...}` as its last line.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

Run = Callable[[Sequence[str], Mapping[str, str], str, float | None], tuple[int | None, str, bool]]

PYTEST_NO_TESTS = 5
SYMBOL_KINDS = frozenset({"function", "method"})


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    detail: str


@dataclass(frozen=True)
class TestRunner:
    workspace: Path
    command: Sequence[str]
    tests_dir: str
    run: Run

    def __call__(self, env: Mapping[str, str], timeout: float | None) -> Check:
        if not (self.workspace / self.tests_dir).is_dir():
            return Check("tests", True, f"no {self.tests_dir}/ directory")
        venv_bin = self.workspace / ".venv" / "bin"
        if venv_bin.is_dir():
            env = {**env, "PATH": f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"}
        code, _, timed_out = self.run(self.command, env, str(self.workspace), timeout)
        if timed_out:
            return Check("tests", False, "tests timed out")
        return Check("tests", code in (0, PYTEST_NO_TESTS), f"exit {code}")


@dataclass(frozen=True)
class Snapshot:
    id: int
    new_violations: frozenset[str]


@dataclass(frozen=True)
class GraphCheck:
    workspace: Path
    codewatch: str
    db: str
    config: str
    baseline: str
    run: Run
    env: Mapping[str, str]

    def _call(self, args: list[str], timeout: float | None) -> tuple[int | None, str]:
        code, stdout, timed_out = self.run([self.codewatch, *args], self.env, str(self.workspace), timeout)
        return (None if timed_out else code), stdout

    def snapshot(self, ref: str, timeout: float | None) -> Snapshot | None:
        """Indexes the work tree and checks it against the baseline; None when either step fails."""
        code, _ = self._call(["graph", "index", ".", "--db", self.db, "--ref", ref], timeout)
        if code != 0:
            return None
        check = ["graph", "check", "--db", self.db, "--config", self.config, "--baseline", self.baseline, "--json"]
        code, stdout = self._call(check, timeout)
        report = _json_object(stdout)
        if code not in (0, 1) or "snapshot" not in report:
            return None
        violations = (report.get("result") or {}).get("violations") or []
        keys = frozenset(f"{v.get('ruleId')}:{v.get('nodeId')}" for v in violations if not v.get("isCarryover"))
        return Snapshot(int(report["snapshot"]["id"]), keys)

    def added_symbols(self, before: int, after: int, timeout: float | None) -> list[dict]:
        code, stdout = self._call(["graph", "diff", "--db", self.db, "--from", str(before),
                                   "--to", str(after), "--json"], timeout)
        diff = (_json_object(stdout).get("diff") or {}) if code == 0 else {}
        return symbols_added(diff)


def symbols_added(diff: Mapping) -> list[dict]:
    calls: dict[str, int] = {}
    for edge in diff.get("addedEdges") or []:
        if edge.get("kind") == "calls":
            calls[edge.get("dstId")] = calls.get(edge.get("dstId"), 0) + 1
    return [
        {"path": node["id"].split("#")[0], "name": node.get("name", ""),
         "flags": ["single-caller-helper"] if calls.get(node["id"]) == 1 else []}
        for node in diff.get("addedNodes") or []
        if node.get("kind") in SYMBOL_KINDS and "id" in node
    ]


def ratchet_check(before: Snapshot | None, after: Snapshot | None) -> Check:
    if before is None or after is None:
        return Check("graph-check", False, "graph check could not run")
    new = sorted(after.new_violations - before.new_violations)
    return Check("graph-check", not new, f"new violations: {', '.join(new[:5])}" if new else "no new violation")


@dataclass(frozen=True)
class Reviewer:
    """The U17 hook: runs the configured review command on one commit."""

    command: Sequence[str] | None
    workspace: Path
    run: Run
    env: Mapping[str, str]

    def __call__(self, commit: str, timeout: float | None) -> dict:
        if not self.command:
            return {"verdict": "not-configured"}
        code, stdout, timed_out = self.run([*self.command, commit], self.env, str(self.workspace), timeout)
        report = _last_json(stdout)
        if timed_out or code != 0 or report.get("verdict") not in ("ok", "conflict"):
            return {"verdict": "error", "reason": "timed out" if timed_out else f"exit {code}, no verdict"}
        return {k: report.get(k) for k in ("verdict", "spec_line", "reason")}


def _json_object(text: str) -> dict:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _last_json(stdout: str) -> dict:
    lines = [line for line in stdout.splitlines() if line.strip()]
    return _json_object(lines[-1]) if lines else {}
