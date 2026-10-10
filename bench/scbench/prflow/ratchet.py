"""The `commit-ratchet` stage: commit the solve on `cp-N`, then ratchet it against its merge-base.

Both sides are indexed into the cache db under refs scoped to the PR branch
(`cw-head-cp-N`, `cw-merge-base-cp-N`). `graph check --baseline` and `graph diff` between
them go to `.codewatch/audit/`. Nothing here blocks: a missing input is a recorded reason.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path

from .repo import HiddenRepo, pr_branch, scoped

Tool = Callable[[list[str], Mapping[str, str], Path], subprocess.CompletedProcess]

CODEWATCH = "codewatch"
CHECK_CONFIG = Path(".codewatch") / "check.json"
DB = Path(".codewatch") / "cache" / "graph.db"
AUDIT = Path(".codewatch") / "audit"
CHECK_OUT = "ratchet-check.json"
DIFF_OUT = "ratchet-diff.json"
HEAD_REF = "cw-head"
MERGE_BASE_REF = "cw-merge-base"
NO_REV = "this codewatch has no `graph index --rev`, so the check ran without a merge-base baseline"
# `graph check` exits 1 when it finds violations and 2 when it could not run.
CHECK_RAN = (0, 1)


def run_codewatch(args: list[str], env: Mapping[str, str], cwd: Path) -> subprocess.CompletedProcess:
    try:
        return subprocess.run([CODEWATCH, *args], cwd=cwd, env=dict(env), capture_output=True,
                              text=True, check=False)
    except FileNotFoundError:
        return subprocess.CompletedProcess([CODEWATCH, *args], 127, "", f"{CODEWATCH} is not on PATH")


def _why(what: str, done: subprocess.CompletedProcess) -> str:
    detail = (done.stderr or done.stdout or "").strip().splitlines()
    return f"{what} exited {done.returncode}" + (f": {detail[-1]}" if detail else "")


def ensure_check_config(tool: Tool, repo: HiddenRepo) -> str | None:
    """Writes codewatch's default check config unless the workspace has one; returns why not."""
    if (repo.workspace / CHECK_CONFIG).is_file():
        return None
    done = tool(["graph", "init", ".", "--db", str(DB), "--json"], repo.env(), repo.workspace)
    if done.returncode == 0 and (repo.workspace / CHECK_CONFIG).is_file():
        return None
    return _why("graph init", done)


def commit_ratchet(repo: HiddenRepo, checkpoint: int, tool: Tool) -> dict:
    if not repo.exists():
        return {"outcome": "skipped", "reason": "no hidden repository; repo-init did not run"}
    branch = pr_branch(checkpoint)
    if repo.branch() != branch:
        return {"outcome": "skipped", "reason": f"HEAD is on {repo.branch()}, not {branch}; pr-open did not run"}
    repo.ensure_excludes()
    solve = repo.commit_all(f"{branch}: solve")
    merge_base = repo.merge_base()
    return {"solve_commit": solve, "merge_base": merge_base,
            **ratchet(repo, branch, solve, merge_base, tool)}


def ratchet(repo: HiddenRepo, branch: str, head: str, merge_base: str, tool: Tool) -> dict:
    head_ref, base_ref = scoped(HEAD_REF, branch), scoped(MERGE_BASE_REF, branch)
    has_rev = "--rev" in tool(["graph", "index", "--help"], repo.env(), repo.workspace).stdout
    failure = _index(tool, repo, head_ref, head if has_rev else None)
    if failure:
        return {"outcome": "failed", "reason": failure}
    baseline, reason = None, NO_REV
    if has_rev:
        reason = _index(tool, repo, base_ref, merge_base)
        baseline = None if reason else base_ref
    audit = repo.workspace / AUDIT
    audit.mkdir(parents=True, exist_ok=True)
    report = {"outcome": "ok", "head_ref": head_ref, "baseline": baseline,
              **_check(tool, repo, head_ref, baseline, audit / CHECK_OUT)}
    if baseline:
        report.update(_diff(tool, repo, baseline, head_ref, audit / DIFF_OUT))
    reasons = [r for r in (reason, report.pop("check_reason", None), report.pop("diff_reason", None)) if r]
    return {**report, **({"reason": "; ".join(reasons)} if reasons else {})}


def _index(tool: Tool, repo: HiddenRepo, ref: str, rev: str | None) -> str | None:
    """Indexes `rev` from git objects, or the work tree when `rev` is None; returns why it failed."""
    args = ["graph", "index", ".", "--db", str(DB), "--ref", ref, "--json"]
    done = tool([*args, *(["--rev", rev] if rev else [])], repo.env(), repo.workspace)
    return None if done.returncode == 0 else _why(f"graph index --ref {ref}", done)


def _check(tool: Tool, repo: HiddenRepo, head_ref: str, baseline: str | None, out: Path) -> dict:
    if not (repo.workspace / CHECK_CONFIG).is_file():
        return {"check_reason": f"no {CHECK_CONFIG}, so no check ran"}
    args = ["graph", "check", "--db", str(DB), "--config", str(CHECK_CONFIG), "--snapshot", head_ref,
            *(["--baseline", baseline] if baseline else []), "--json"]
    done = tool(args, repo.env(), repo.workspace)
    report = _json(done.stdout) if done.returncode in CHECK_RAN else None
    if report is None:
        return {"check_reason": _why("graph check", done)}
    out.write_text(json.dumps(report, indent=2) + "\n")
    violations = (report.get("result") or {}).get("violations") or []
    new = [v for v in violations if isinstance(v, dict) and not v.get("isCarryover")]
    return {"items_in": len(violations), "items_out": len(new)}


def _diff(tool: Tool, repo: HiddenRepo, baseline: str, head_ref: str, out: Path) -> dict:
    args = ["graph", "diff", "--db", str(DB), "--from", baseline, "--to", head_ref, "--json"]
    done = tool(args, repo.env(), repo.workspace)
    report = _json(done.stdout) if done.returncode == 0 else None
    if report is None:
        return {"diff_reason": _why("graph diff", done)}
    out.write_text(json.dumps(report, indent=2) + "\n")
    return {}


def _json(text: str) -> dict | None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
