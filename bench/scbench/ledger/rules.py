"""The rules the ledger enforces (C-248 S5, folding C-230):

  stale     a task re-checks its finding at start: the head unit still exists and is still over hot_cc.
            If not, the task is a `skip` and never reaches a session.
  repeat    a (symbol, type) kept earlier is suppressed unless the symbol's AST changed since it was kept.
  reinline  the T2 re-inline check: a change that removes a function an earlier kept task split out
            undoes that task (C-238 excerpt 3, the `_token_is` split-then-inline case).
"""

from __future__ import annotations

import ast
import hashlib

from planner.units import Unit, module_units


def unit(texts: dict[str, str], key: str) -> Unit | None:
    rel = key.split(":", 1)[0]
    parsed = module_units(rel, texts[rel]) if rel in texts else None
    return next((u for u in parsed[1] if u.key == key), None) if parsed else None


def digest(texts: dict[str, str], key: str) -> str | None:
    found = unit(texts, key)
    return hashlib.sha1(ast.dump(found.node).encode()).hexdigest()[:12] if found else None


def removed(report: dict) -> list[str]:
    return sorted(set(report["touched_before"]) - set(report["touched_after"]))


def stale(task: dict, texts: dict[str, str], cfg: dict) -> str | None:
    head = unit(texts, task["id"])
    if head is None:
        return f"stale: {task['id']} no longer exists"
    if head.cc <= cfg["hot_cc"]:
        return f"stale: {task['id']} CC {head.cc} is no longer over {cfg['hot_cc']}"
    return None


def repeat(rows: list[dict], task: dict, kind: str, texts: dict[str, str]) -> str | None:
    now = digest(texts, task["id"])
    for row in rows:
        if row.get("kept") and row["symbol"] == task["id"] and row["task_type"] == kind and row["symbol_digest"] == now:
            return f"repeat: {task['id']} was kept as {kind} in run {row['run']} and has not changed"
    return None


def at_start(rows: list[dict], task: dict, kind: str, texts: dict[str, str], cfg: dict) -> str | None:
    """The skip reason for a task about to start, or None when it should run."""
    return stale(task, texts, cfg) or repeat(rows, task, kind, texts)


def reinlined(rows: list[dict], report: dict) -> list[str]:
    """T2 reasons for each function this change removes that an earlier kept task split out."""
    gone = set(removed(report))
    return [f"re-inlines {key}, split out by {row['cluster']} (run {row['run']})"
            for row in rows if row.get("kept") for key in row["new"] if key in gone]
