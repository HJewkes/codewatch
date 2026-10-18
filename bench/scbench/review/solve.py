"""`python -m review.solve`: the solve-review stage (U17 on the solve commit, D150.6).

It reviews the head of `cp-N`, the solve commit `commit-ratchet` made, with the review
command in `expected-output` mode. On a conflict it resumes the solve session once
(`--resume $CW_SOLVE_SESSION_ID`) with the reviewer's reason and spec line, amends the solve
commit with the revision and reviews it again. The solve is never reverted: a conflict that
stands is recorded. Paths under `.codewatch/` are left out of the amend, so triage's
uncommitted verdict fragment stays as it was.

Prints the stage report as its last stdout line.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from prflow.repo import HiddenRepo, pr_branch
from remediation.fixer import Clock
from remediation.session import FixSession, Run, run_process

SESSION_ENV = "CW_SOLVE_SESSION_ID"
REVIEW_FIELDS = ("verdict", "spec_line", "reason")
OUTSIDE_CODEWATCH = ("--", ".", ":(exclude).codewatch")


@dataclass(frozen=True)
class Config:
    workspace: Path
    review_command: Sequence[str]
    checkpoint: int
    session_id: str | None
    deadline: float | None
    margin: float


def resume_prompt(reason: str, spec_line: int | None) -> str:
    where = f" (specification line {spec_line})" if spec_line else ""
    return (f"A review of your solution found a change to expected outputs, in a golden file or a test "
            f"assertion, that the specification does not require{where}: {reason}\n"
            "Revise it so the tests check the behaviour the specification defines, then stop.")


def run_review(command: Sequence[str], sha: str, repo: HiddenRepo, run: Run, timeout: float | None) -> dict:
    code, stdout, timed_out = run([*command, sha], repo.env(), str(repo.workspace), timeout)
    report = _last_json(stdout)
    if timed_out or code != 0 or report.get("verdict") not in ("ok", "conflict"):
        return {"verdict": "error", "spec_line": None, "tokens": 0, "usd": 0.0,
                "reason": "timed out" if timed_out else f"exit {code}, no verdict"}
    return {**{k: report.get(k) for k in REVIEW_FIELDS},
            "tokens": int(report.get("tokens") or 0), "usd": float(report.get("usd") or 0.0)}


def solve_review(config: Config, env: dict[str, str], run_claude: Run, run_tool: Run, clock: Clock) -> dict:
    repo = HiddenRepo.at(config.workspace)
    why_not = _why_not(repo, config.checkpoint)
    if why_not:
        return {"outcome": "skipped", "reason": why_not}
    sha = repo.rev("HEAD")
    first = run_review(config.review_command, sha, repo, run_tool, clock.remaining())
    report = {"solve_commit": sha, **first, "resumed": False, "second_verdict": None}
    if first["verdict"] != "conflict":
        return {**report, "outcome": first["verdict"]}
    if not config.session_id:
        return {**report, "outcome": "conflict", "reason": f"{first['reason']}; no solve session id to resume"}
    if not clock.may_start():
        return {**report, "outcome": "conflict", "reason": f"{first['reason']}; no time left to resume"}
    session = FixSession(env, str(repo.workspace), run_claude, session_id=config.session_id, started=True)
    return {**report, **resume_once(config, repo, first, session, run_tool, clock)}


def resume_once(config: Config, repo: HiddenRepo, first: dict, session: FixSession, run_tool: Run,
                clock: Clock) -> dict:
    call = session.ask(resume_prompt(first["reason"] or "", first["spec_line"]), clock.call_timeout())
    spent = {"resumed": True, "session_id": session.session_id, "turns": session.turns,
             "tokens": first["tokens"] + session.tokens, "usd": first["usd"] + session.usd}
    if call.timed_out:
        _restore(repo, repo.rev("HEAD"))
        return {**spent, "outcome": "conflict", "reason": "the resumed session timed out; the solve is kept as it was"}
    revised = _amend(repo)
    if revised is None:
        return {**spent, "outcome": "conflict", "reason": f"{first['reason']}; the resumed session changed nothing"}
    second = run_review(config.review_command, revised, repo, run_tool, clock.remaining())
    return {**spent, "revised_commit": revised, "second_verdict": second["verdict"],
            "second_spec_line": second["spec_line"], "reason": second["reason"],
            "outcome": "revised" if second["verdict"] == "ok" else second["verdict"],
            "tokens": spent["tokens"] + second["tokens"], "usd": spent["usd"] + second["usd"]}


def _why_not(repo: HiddenRepo, checkpoint: int) -> str | None:
    if not repo.exists():
        return "no hidden repository; repo-init did not run"
    branch = pr_branch(checkpoint)
    if repo.branch() != branch:
        return f"HEAD is on {repo.branch()}, not {branch}; pr-open did not run"
    return None


def _amend(repo: HiddenRepo) -> str | None:
    """Amends HEAD with the session's edits outside `.codewatch/`; None when it made none."""
    repo.run("add", "-A", *OUTSIDE_CODEWATCH)
    if repo.succeeds("diff", "--cached", "--quiet"):
        return None
    # A revision that undoes the solve's only change leaves an empty commit, as commit-ratchet allows.
    repo.run("commit", "-q", "--no-verify", "--allow-empty", "--amend", "--no-edit")
    return repo.rev("HEAD")


def _restore(repo: HiddenRepo, sha: str) -> None:
    repo.run("restore", "--source", sha, "--staged", "--worktree", *OUTSIDE_CODEWATCH)
    repo.run("clean", "-q", "-fd", *OUTSIDE_CODEWATCH)


def _last_json(stdout: str) -> dict:
    lines = [line for line in stdout.splitlines() if line.strip()]
    try:
        parsed = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def parse_args(argv: list[str], env: dict[str, str]) -> Config:
    p = argparse.ArgumentParser(prog="python -m review.solve")
    p.add_argument("--workspace", type=Path, default=Path.cwd())
    p.add_argument("--review-command", required=True,
                   help="gets the solve sha and prints a verdict; give it --mode expected-output")
    p.add_argument("--checkpoint", type=int, default=int(env.get("CW_CHECKPOINT") or 0))
    p.add_argument("--session-id", default=env.get(SESSION_ENV), help=f"default: ${SESSION_ENV}")
    p.add_argument("--deadline", type=float,
                   default=float(env["CW_STAGE_DEADLINE"]) if env.get("CW_STAGE_DEADLINE") else None)
    p.add_argument("--margin", type=float, default=120.0, help="seconds kept for the second review")
    a = p.parse_args(argv)
    if a.checkpoint < 1:
        p.error("--checkpoint or CW_CHECKPOINT is required")
    return Config(a.workspace.resolve(), shlex.split(a.review_command), a.checkpoint, a.session_id or None,
                  a.deadline, a.margin)


def main(argv: list[str]) -> int:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    config = parse_args(argv, env)
    try:
        report = solve_review(config, env, run_process, run_process, Clock(config.deadline, config.margin))
    except Exception as error:  # noqa: BLE001 - the stage records the reason, the checkpoint goes on
        print(json.dumps({"outcome": "failed", "reason": f"{type(error).__name__}: {error}"}))
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
