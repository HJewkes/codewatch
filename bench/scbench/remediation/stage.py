"""Propose, validate, discard: the remediation stage of arm A1 (design unit U8).

It returns the report line the stage agent copies into `stages.json`: `outcome` is
`kept`, `discarded` or `skipped`, and `reason` says why.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

from . import workspace as ws
from .items import Item, controls_failed, read_jsonl, select_items
from .session import Run, SessionResult, run_session
from .validate import (
    Check,
    CommandReplay,
    GraphCheck,
    TestRunner,
    ratchet_check,
    replay_check,
)

AUDIT_DIR = Path(".codewatch") / "audit"
MAX_TURNS_SUBTYPE = "error_max_turns"


@dataclass(frozen=True)
class Config:
    workspace: Path
    scratch: Path
    codewatch: str
    test_command: Sequence[str]
    replay_command: Sequence[str] | None
    session_timeout: float
    tool_timeout: float


@dataclass(frozen=True)
class Tools:
    tests: TestRunner
    replay: CommandReplay
    graph: GraphCheck


def load_items(root: Path) -> tuple[list[Item], int]:
    audit = root / AUDIT_DIR
    return select_items(
        read_jsonl(audit / "verdicts.jsonl"), read_jsonl(audit / "findings.jsonl"),
        controls_failed(audit / "triage.json"),
    )


def tools_for(config: Config, run: Run) -> Tools:
    root, timeout = config.workspace, config.tool_timeout
    return Tools(
        tests=TestRunner(root, config.test_command, run, timeout),
        replay=CommandReplay(root, config.replay_command, run, timeout),
        graph=GraphCheck(root, config.codewatch, run, timeout),
    )


def remediate(config: Config, env: Mapping[str, str], run_claude: Run, run_tool: Run) -> dict:
    items, held_back = load_items(config.workspace)
    base = {"items_in": len(items), "held_back": held_back}
    if not items:
        return {**base, "outcome": "skipped", "reason": "no confirmed items"}
    if ws.inside(config.workspace, config.scratch):
        return {**base, "outcome": "skipped", "reason": f"scratch {config.scratch} is inside the workspace"}
    tools = tools_for(config, run_tool)
    pre = tools.graph.snapshot("remediation-pre")
    if pre is None:
        return {**base, "outcome": "skipped", "reason": "graph check could not run before remediation"}
    replay_before = tools.replay.diffs()
    tests_before = tools.tests(env)
    saved = ws.backup(config.workspace, config.scratch)
    try:
        session = run_session(items, env, str(config.workspace), config.session_timeout, run_claude)
        verdict = _judge(session, tools, env, pre["snapshot"]["id"], replay_before, tests_before)
    except BaseException:
        error = _restore_or_keep(config.workspace, saved)
        if error:
            print(f"remediation: restore failed ({error}); backup kept at {saved}", file=sys.stderr)
        raise
    verdict = _settle(config.workspace, saved, verdict)
    kept = verdict["outcome"] == "kept"
    return {**base, **_session_fields(session), **verdict, "items_out": len(items) if kept else 0}


def _restore_or_keep(workspace: Path, saved: Path) -> str | None:
    """Restores and then drops the backup; on a failed restore the backup stays and the error is returned."""
    try:
        ws.restore(workspace, saved)
    except Exception as error:  # noqa: BLE001 - the backup must survive any restore failure
        return f"{type(error).__name__}: {error}"
    ws.drop(saved)
    return None


def _settle(workspace: Path, saved: Path, verdict: dict) -> dict:
    if verdict["outcome"] == "kept":
        ws.drop(saved)
        return verdict
    error = _restore_or_keep(workspace, saved)
    if error is None:
        return verdict
    note = f"restore failed ({error}); backup kept at {saved}"
    return {**verdict, "reason": f"{verdict['reason']}; {note}", "backup": str(saved)}


def _judge(session: SessionResult, tools: Tools, env: Mapping[str, str], pre_id: int,
           replay_before: frozenset[str] | None, tests_before: Check) -> dict:
    if session.timed_out:
        return {"outcome": "discarded", "reason": "session timed out", "validation": []}
    if session.exit_code != 0 and session.subtype != MAX_TURNS_SUBTYPE:
        return {"outcome": "discarded", "reason": f"session failed: exit {session.exit_code}", "validation": []}
    tests = tools.tests(env)
    replay, fixed = replay_check(replay_before, tools.replay.diffs())
    ratchet = ratchet_check(tools.graph.snapshot("remediation-post", baseline=pre_id))
    checks = [tests, replay, ratchet]
    failed = [c for c in checks if not c.passed]
    return {
        "outcome": "discarded" if failed else "kept",
        "reason": _reason(failed, tests_before),
        "validation": [asdict(c) for c in checks],
        "fixed_replay_diffs": 0 if failed else fixed,
    }


def _reason(failed: list[Check], tests_before: Check) -> str:
    if not failed:
        return "all checks passed"
    reasons = [f"{c.name}: {c.detail}" for c in failed]
    if any(c.name == "tests" for c in failed) and not tests_before.passed:
        reasons.append(f"tests were already failing before remediation ({tests_before.detail})")
    return "; ".join(reasons)


def _session_fields(session: SessionResult) -> dict:
    return {"session_id": session.session_id, "turns": session.turns,
            "tokens": session.tokens, "usd": session.usd}
