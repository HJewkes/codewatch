"""The A1 audit stage: every Layer 1 finding source for one checkpoint, in one findings.jsonl.

`codewatch audit` runs first and rewrites `.codewatch/audit/findings.jsonl`. Tier T, diff
coverage (coverage.py over the agent's tests) and jscpd clones then append their rows.
Diff coverage and `audit --changed-from` both take the PR's merge-base as a git commit,
read from the hidden repository: the graph ref `cw-merge-base-cp-N` names a snapshot in
the graph database, not a git ref. A source that fails is a recorded reason; only a
failed `codewatch audit` fails the stage.

    PYTHONPATH=/opt/codewatch-a1 python -P -m findings.audit_stage --workspace /workspace
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping
from pathlib import Path

from prflow.repo import GitError, HiddenRepo

Run = Callable[[list[str], Mapping[str, str], Path], subprocess.CompletedProcess]

CODEWATCH = "codewatch"
TIERT = "/opt/codewatch-a1/tiert"
AUDIT = Path(".codewatch") / "audit"
FINDINGS = "findings.jsonl"
# The workspace is a bind mount whose owner may differ from the container user.
SAFE_DIRECTORY = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "safe.directory", "GIT_CONFIG_VALUE_0": "*"}


def run_tool(command: list[str], env: Mapping[str, str], cwd: Path) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, cwd=cwd, env=dict(env), capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return subprocess.CompletedProcess(command, 127, "", f"{command[0]} is not on PATH")


def merge_base(workspace: Path) -> tuple[str | None, Mapping[str, str]]:
    """The PR's merge-base commit and the env that lets git find it, or None and the plain env."""
    repo = HiddenRepo.at(workspace)
    if not repo.exists():
        return None, os.environ
    try:
        return repo.merge_base(), {**repo.env(), **SAFE_DIRECTORY}
    except GitError:
        return None, os.environ


def audit_command(run: Run, env: Mapping[str, str], workspace: Path, base: str | None) -> list[str]:
    """Passes only the flags this codewatch has: @codewatch/cli 0.7.0 has neither."""
    help_text = run([CODEWATCH, "audit", "--help"], env, workspace).stdout
    command = [CODEWATCH, "audit", str(workspace)]
    if base and "--changed-from" in help_text:
        command += ["--changed-from", base]
    if "--no-ts-slop" in help_text:
        command.append("--no-ts-slop")
    return command


def appended_sources(workspace: Path, base: str | None) -> dict[str, tuple[list[str], Path | None]]:
    """Each source's command and the file of rows to append, or None when it appends itself."""
    audit, module = workspace / AUDIT, [sys.executable, "-P", "-m"]
    sources: dict[str, tuple[list[str], Path | None]] = {
        "tiert": (["python3", TIERT, str(workspace), "--out", str(audit / FINDINGS), "--append"], None),
    }
    if base:
        sources["diff-uncovered"] = ([*module, "findings.diff_uncovered", "--workspace", str(workspace),
                                      "--base-rev", base, "--out", str(audit / "diff-uncovered.jsonl")],
                                     audit / "diff-uncovered.jsonl")
    sources["clones"] = ([*module, "findings.clones", "--workspace", str(workspace),
                          "--out", str(audit / "clones.jsonl")], audit / "clones.jsonl")
    return sources


def audit_stage(workspace: Path, run: Run) -> dict:
    base, env = merge_base(workspace)
    audited = run(audit_command(run, env, workspace, base), env, workspace)
    if audited.returncode != 0:
        return {"outcome": "failed", "reason": _why("codewatch audit", audited), "merge_base": base}
    findings = workspace / AUDIT / FINDINGS
    reasons = [] if base else ["no merge-base in the hidden repository, so diff coverage did not run"]
    sources = {}
    for name, (command, rows) in appended_sources(workspace, base).items():
        done = run(command, env, workspace)
        if rows is not None and rows.is_file():
            with findings.open("a", encoding="utf-8") as out:
                out.write(rows.read_text())
        sources[name] = {"exit": done.returncode, **_last_json(done.stdout)}
        if done.returncode != 0:
            reasons.append(_why(name, done))
    report = {"outcome": "ok", "merge_base": base, "items_out": _count(findings), "sources": sources}
    return {**report, **({"reason": "; ".join(reasons)} if reasons else {})}


def _why(what: str, done: subprocess.CompletedProcess) -> str:
    detail = (done.stderr or done.stdout or "").strip().splitlines()
    return f"{what} exited {done.returncode}" + (f": {detail[-1]}" if detail else "")


def _last_json(stdout: str) -> dict:
    lines = [line for line in stdout.splitlines() if line.strip()]
    try:
        parsed = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _count(findings: Path) -> int:
    return sum(1 for line in findings.read_text().splitlines() if line.strip()) if findings.is_file() else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="findings.audit_stage", description=__doc__.splitlines()[0])
    parser.add_argument("--workspace", type=Path, default=Path("/workspace"))
    report = audit_stage(parser.parse_args(argv).workspace.resolve(), run_tool)
    print(json.dumps(report))
    return 1 if report["outcome"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
