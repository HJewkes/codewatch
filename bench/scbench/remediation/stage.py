"""The A1 fix stage (design unit U8, Revision 1): one validated commit per confirmed item.

It works on the PR branch of the hidden repository, in phase order, and stops only when
the items run out or the stage deadline nears. Then it resets the work tree to the last
kept commit. A whole-workspace backup is the last resort: it is restored only if that
reset fails after an error, and it is kept, with its path reported, if the restore fails.

It returns the report line the stage agent copies into `stages.json`.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from . import workspace as ws
from .fixer import TIME_LIMIT, Clock, Fixer
from .git import Git, scoped
from .items import Item, controls_failed, read_jsonl, select_items
from .session import FixSession, Run
from .validate import GraphCheck, Reviewer, TestRunner

AUDIT_DIR = Path(".codewatch") / "audit"
MERGE_BASE_REF = "cw-merge-base"


@dataclass(frozen=True)
class Config:
    workspace: Path
    scratch: Path
    git_dir: Path
    codewatch: str
    db: str
    check_config: str
    baseline: str | None
    tests_dir: str
    test_command: Sequence[str]
    review_command: Sequence[str] | None
    deadline: float | None
    reset_margin: float
    max_items: int | None = None
    max_turns: int | None = None


def load_items(config: Config, changed: set[str]) -> tuple[list[Item], int]:
    audit = config.workspace / AUDIT_DIR
    return select_items(read_jsonl(audit / "verdicts.jsonl"), read_jsonl(audit / "findings.jsonl"),
                        changed, controls_failed(audit / "triage.json"), config.max_items)


def remediate(config: Config, env: Mapping[str, str], run_claude: Run, run_tool: Run, clock: Clock) -> dict:
    git = Git(config.workspace, config.git_dir)
    if not git.exists():
        return {"outcome": "skipped", "reason": f"no hidden repository at {config.git_dir}"}
    git.ignore_tool_output()
    if git.dirty():
        return {"outcome": "skipped", "reason": "the work tree has uncommitted changes"}
    items, held_back = load_items(config, git.changed_files(git.merge_base()))
    base = {"items_in": len(items), "held_back": held_back}
    if not items:
        return {**base, "outcome": "skipped", "reason": "no confirmed items"}
    if ws.inside(config.workspace, config.scratch):
        return {**base, "outcome": "skipped", "reason": f"scratch {config.scratch} is inside the workspace"}
    fixer = build_fixer(config, env, git, run_claude, run_tool, clock)
    saved = ws.backup(config.workspace, config.scratch)
    try:
        records, stopped = run_items(fixer, items)
    except BaseException:
        _recover(fixer, config.workspace, saved)
        raise
    ws.drop(saved)
    return {**base, **summarize(records, stopped), **_session_fields(fixer.session)}


def build_fixer(config: Config, env: Mapping[str, str], git: Git, run_claude: Run, run_tool: Run,
                clock: Clock) -> Fixer:
    tool_env, pr_branch = {**env, **git.env()}, git.branch()
    merge_base_ref = scoped(MERGE_BASE_REF, pr_branch)
    graph = GraphCheck(config.workspace, config.codewatch, config.db, config.check_config,
                       config.baseline or merge_base_ref, run_tool, tool_env)
    if config.baseline is None:
        index = ["graph", "index", ".", "--db", config.db, "--rev", git.merge_base(), "--ref", merge_base_ref]
        run_tool([config.codewatch, *index], tool_env, str(config.workspace), clock.remaining())
    fixer = Fixer(
        git=git, session=FixSession(env, str(config.workspace), run_claude, config.max_turns),
        tests=TestRunner(config.workspace, config.test_command, config.tests_dir, run_tool),
        graph=graph, reviewer=Reviewer(config.review_command, config.workspace, run_tool, tool_env),
        clock=clock, env=env, tests_dir=config.tests_dir, base_branch=pr_branch,
        kept_head=git.head(), current=None,
    )
    fixer.current = graph.snapshot(fixer.fix_ref, clock.remaining())
    return fixer


def run_items(fixer: Fixer, items: list[Item]) -> tuple[list[dict], str | None]:
    records, stopped = [], None
    for n, item in enumerate(items, start=1):
        if stopped is None and not fixer.clock.may_start():
            stopped = TIME_LIMIT
        outcome = {"status": "not-started", "reason": stopped} if stopped else fixer.fix(n, item)
        if outcome["status"] == TIME_LIMIT:
            stopped = TIME_LIMIT
        records.append({**describe(item), **outcome})
    if stopped:
        fixer.git.reset_to(fixer.base_branch, fixer.kept_head)
    return records, stopped


def describe(item: Item) -> dict:
    return {"phase": item.phase, "signal": item.signal, "path": item.path, "symbol": item.symbol}


def summarize(records: list[dict], stopped: str | None) -> dict:
    statuses = [r["status"] for r in records]
    kept = [r for r in records if r["status"] == "kept"]
    outcome = "kept" if kept else "reverted" if "reverted" in statuses else "unchanged"
    reason = f"{len(kept)} kept, {statuses.count('reverted')} reverted of {len(records)}"
    return {
        "outcome": outcome, "reason": reason + (f"; stopped at the {stopped}" if stopped else ""),
        "items_out": len(kept), "stopped_by": stopped, "items": records,
        "added_symbols": [s for r in kept for s in r.get("added_symbols", [])],
    }


def _recover(fixer: Fixer, workspace: Path, saved: Path) -> None:
    """After an error: reset to the last kept commit, else restore the backup, else keep it."""
    try:
        fixer.git.reset_to(fixer.base_branch, fixer.kept_head)
    except Exception as error:  # noqa: BLE001 - fall back to the whole-workspace backup
        print(f"remediation: git reset failed ({error}); restoring the backup", file=sys.stderr)
        failure = ws.restore_or_keep(workspace, saved)
        if failure:
            print(f"remediation: restore failed ({failure}); backup kept at {saved}", file=sys.stderr)
        return
    ws.drop(saved)


def _session_fields(session: FixSession) -> dict:
    return {"session_id": session.session_id if session.started else None, "turns": session.turns,
            "tokens": session.tokens, "usd": session.usd}
