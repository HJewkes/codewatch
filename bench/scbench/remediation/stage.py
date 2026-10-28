"""The A1 fix stage (design unit U8, Revision 1): one validated commit per confirmed item.

Before any item it runs the test check once at the base (`oracle`), records the result,
and starts nothing when the check is unavailable. It works on the PR branch of the hidden
repository, in phase order, and stops when the items run out, when the stage deadline
nears, or when `SAME_CAUSE_STOP` items in a row are reverted for the same reason, which
points at a broken check rather than at the items. At the deadline it resets the work tree
to the last kept commit. A whole-workspace backup is the last resort: it is restored only if that
reset fails after an error, and it is kept, with its path reported, if the restore fails.

It returns the report line the stage agent copies into `stages.json`.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

from . import workspace as ws
from .fixer import TIME_LIMIT, Clock, Fixer
from findings.diff_uncovered import DEFAULT_COVERAGE
from prflow.ratchet import MERGE_BASE_REF
from prflow.repo import HiddenRepo, scoped

from .admission import Admission, Coverage
from .git import Git
from .items import Item, controls_failed, evidence_field, read_jsonl, select_items
from .session import FixSession, Run
from .interpreter import DEFAULT_TOOL_PYTEST, Resolver, TestCommand
from .oracle import UNAVAILABLE, TestRunner
from .validate import GraphCheck, Reviewer

AUDIT_DIR = Path(".codewatch") / "audit"
ITEMS_FILE = "items.jsonl"
SAME_CAUSE_STOP = 3
STAGE_STOPPED = "stage-stopped"


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
    tool_pytest: str = DEFAULT_TOOL_PYTEST
    coverage: str = DEFAULT_COVERAGE


def load_items(config: Config, changed: set[str]) -> tuple[list[Item], int]:
    """Items on paths the hidden repository ignores, such as the task's `files/` tree or a
    virtualenv, are not the project's code; a verdict carried from an earlier run may cite one."""
    audit = config.workspace / AUDIT_DIR
    items, held_back = select_items(read_jsonl(audit / "verdicts.jsonl"), read_jsonl(audit / "findings.jsonl"),
                                    changed, controls_failed(audit / "triage.json"))
    ignored = HiddenRepo(config.workspace, config.git_dir).ignored(sorted({i.path for i in items if i.path}))
    project = [i for i in items if i.path not in ignored]
    return (project if config.max_items is None else project[:config.max_items]), held_back


def write_item_list(workspace: Path, items: list[Item]) -> None:
    (workspace / AUDIT_DIR).mkdir(parents=True, exist_ok=True)
    (workspace / AUDIT_DIR / ITEMS_FILE).write_text("".join(json.dumps(describe(i)) + "\n" for i in items))


def remediate(config: Config, env: Mapping[str, str], run_claude: Run, run_tool: Run, clock: Clock) -> dict:
    # A list left by an earlier checkpoint must not be kept as this one's.
    (config.workspace / AUDIT_DIR / ITEMS_FILE).unlink(missing_ok=True)
    git = Git(config.workspace, config.git_dir)
    if not git.exists():
        return {"outcome": "skipped", "reason": f"no hidden repository at {config.git_dir}"}
    git.ignore_tool_output()
    if git.dirty():
        return {"outcome": "skipped", "reason": "the work tree has uncommitted changes"}
    items, held_back = load_items(config, git.changed_files(git.merge_base()))
    write_item_list(config.workspace, items)
    base ={"items_in": len(items), "held_back": held_back}
    if not items:
        return {**base, "outcome": "skipped", "reason": "no confirmed items"}
    if ws.inside(config.workspace, config.scratch):
        return {**base, "outcome": "skipped", "reason": f"scratch {config.scratch} is inside the workspace"}
    tests, base = prove_tests(config, env, run_tool, clock, base)
    if tests is None:
        print(f"remediation: {base['reason']}; no item started", file=sys.stderr)
        return base
    fixer = build_fixer(config, env, git, (run_claude, run_tool), tests, clock)
    saved = ws.backup(config.workspace, config.scratch)
    try:
        records, stopped = run_items(fixer, items)
    except BaseException:
        _recover(fixer, config.workspace, saved)
        raise
    ws.drop(saved)
    return {**base, **summarize(records, stopped), **_cost_fields(fixer)}


def resolve_tests(config: Config, env: Mapping[str, str], run_tool: Run, clock: Clock) -> TestCommand | None:
    """Found once, before any item: a check that cannot import pytest would revert every fix.
    Without a tests directory the check passes without running, so any command will do."""
    if not (config.workspace / config.tests_dir).is_dir():
        return TestCommand(tuple(config.test_command), "unused")
    resolve = Resolver(config.workspace, config.tool_pytest, config.scratch, run_tool)
    tests = resolve(config.test_command, env, clock.remaining())
    if tests is not None:
        print(f"remediation: the test check runs with the {tests.source} interpreter", file=sys.stderr)
    return tests


def prove_tests(config: Config, env: Mapping[str, str], run_tool: Run, clock: Clock,
                base: dict) -> tuple[TestRunner | None, dict]:
    """The preflight: the check, with its base failures, or None and the report when it cannot run."""
    command = resolve_tests(config, env, run_tool, clock)
    if command is None:
        reason = f"no interpreter with pytest for the test check, and no {config.tool_pytest}"
        oracle = {"class": UNAVAILABLE, "failing": [], "reason": reason}
        return None, {**base, "oracle": oracle, "outcome": "check-unavailable", "reason": reason}
    if not command.prefix:
        print("remediation: a custom test command is judged by its exit code", file=sys.stderr)
    tests = TestRunner(config.workspace, command, config.tests_dir, run_tool)
    baseline = tests.preflight(env, clock.remaining())
    base = {**base, "oracle": baseline.report()}
    if baseline.kind == UNAVAILABLE:
        return None, {**base, "outcome": "check-unavailable", "reason": baseline.reason}
    return replace(tests, base=baseline.failing), base


def build_fixer(config: Config, env: Mapping[str, str], git: Git, runs: tuple[Run, Run], tests: TestRunner,
                clock: Clock) -> Fixer:
    run_claude, run_tool = runs
    tool_env, pr_branch = {**env, **git.env()}, git.branch()
    # commit-ratchet (U15) indexed the merge-base under this ref; it is not indexed again here.
    baseline = config.baseline or scoped(MERGE_BASE_REF, pr_branch)
    graph = GraphCheck(config.workspace, config.codewatch, config.db, config.check_config,
                       baseline, run_tool, tool_env)
    fixer = Fixer(
        git=git, session=FixSession(env, str(config.workspace), run_claude, config.max_turns),
        tests=tests,
        graph=graph, reviewer=Reviewer(config.review_command, config.workspace, run_tool, tool_env),
        clock=clock, env=env, tests_dir=config.tests_dir, base_branch=pr_branch,
        kept_head=git.head(), current=None, admission=build_admission(config, git, run_tool),
    )
    fixer.current = graph.snapshot(fixer.fix_ref, clock.remaining())
    return fixer


def build_admission(config: Config, git: Git, run_tool: Run) -> Admission | None:
    """None without the coverage binary, which leaves every test-gap item not started."""
    if not Path(config.coverage).is_file():
        return None
    coverage = Coverage(config.coverage, config.workspace, config.scratch / "admission", config.tests_dir, run_tool)
    return Admission(git, coverage)


def run_items(fixer: Fixer, items: list[Item]) -> tuple[list[dict], str | None]:
    records, stopped = [], None
    for n, item in enumerate(items, start=1):
        if stopped is None and not fixer.clock.may_start():
            stopped = TIME_LIMIT
        outcome = {"status": "not-started", "reason": stopped} if stopped else fixer.fix(n, item)
        if outcome["status"] == TIME_LIMIT:
            stopped = TIME_LIMIT
        records.append({**describe(item), **outcome})
        if stopped is None and (cause := repeated_cause(records)):
            stopped = f"{STAGE_STOPPED}: {cause}"
    if stopped == TIME_LIMIT:
        fixer.git.reset_to(fixer.base_branch, fixer.kept_head)
    return records, stopped


def repeated_cause(records: list[dict]) -> str | None:
    """The reason the last `SAME_CAUSE_STOP` items were all reverted for, if it is one reason."""
    last = records[-SAME_CAUSE_STOP:]
    if len(last) < SAME_CAUSE_STOP or any(r["status"] != "reverted" for r in last):
        return None
    causes = {r["cause"] for r in last}
    return causes.pop() if len(causes) == 1 else None


def describe(item: Item) -> dict:
    return {"phase": item.phase, "kind": item.kind, "signal": item.signal, "path": item.path,
            "symbol": item.symbol, "missing": evidence_field(item.evidence, "missing")}


def summarize(records: list[dict], stopped: str | None) -> dict:
    statuses = [r["status"] for r in records]
    kept = [r for r in records if r["status"] == "kept"]
    outcome = "kept" if kept else "reverted" if "reverted" in statuses else "unchanged"
    reason = f"{len(kept)} kept, {statuses.count('reverted')} reverted of {len(records)}"
    admitted, rejected = admission_counts(records)
    if admitted or rejected:
        reason += f"; {admitted} new tests admitted, {rejected} rejected"
    if stopped and stopped.startswith(STAGE_STOPPED):
        outcome, reason = STAGE_STOPPED, f"{reason}; {stopped}"
    elif stopped:
        reason += f"; stopped at the {stopped}"
    return {
        "outcome": outcome, "reason": reason,
        "items_out": len(kept), "stopped_by": stopped, "items": records,
        "added_symbols": [s for r in kept for s in r.get("added_symbols", [])],
        "tests_admitted": admitted, "tests_rejected": rejected,
    }


def admission_counts(records: list[dict]) -> tuple[int, int]:
    """New tests kept, and new tests the gate rejected; a reverted commit keeps none of its tests."""
    gated = [(r["status"], r["admission"]) for r in records if r.get("admission")]
    admitted = sum(len(g["admitted"]) for status, g in gated if status == "kept")
    return admitted, sum(len(g["rejected"]) for _, g in gated)


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


def _cost_fields(fixer: Fixer) -> dict:
    """`usd` stays the fix session's own spend; `usd_total` adds the review calls to it."""
    session = fixer.session
    return {"session_id": session.session_id if session.started else None, "turns": session.turns,
            "tokens": session.tokens, "usd": session.usd, "model_usage": session.model_usage,
            "call_usage": session.call_usage, "review_tokens": fixer.review_tokens,
            "review_usd": fixer.review_usd, "usd_total": session.usd + fixer.review_usd}
