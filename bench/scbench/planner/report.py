"""Cleanup-report numbers keyed by the planner's task clusters, in place of the body-hash touched set.

A task cluster is touched when the change added, edited or removed any of its functions. Before, it
holds the task's owned units in the before tree. After, it holds those that survive plus each new
function whose nearest task-owned cluster ancestor in the after tree is one of them. Touched functions
that no task owns are listed as untasked. Numbers are dilution.py's scb-compatible measures.
"""

from __future__ import annotations

from pathlib import Path

from planner import graph
from planner.tasks import cluster_parents, plan_tasks
from planner.units import dilution


def _new_function_homes(after_root: Path, owned: dict[str, str]) -> dict[str, str]:
    """new function key -> head of the before-task it joins, via the after tree's cluster parents."""
    units, edges = graph(after_root)
    parent = cluster_parents(units, edges)
    homes = {}
    for key in sorted(set(units) - set(owned)):
        node = parent[key]
        while node is not None and node not in owned:
            node = parent[node]
        if node is not None:
            homes[key] = owned[node]
    return homes


def cluster_numbers(before_root: Path, after_root: Path, before: list, after: list, touched: set[str]) -> dict:
    units, edges = graph(before_root)
    plan = plan_tasks(units, edges)
    owned = {row["key"]: t["id"] for t in plan["tasks"] for row in t["owned"]}
    homes = _new_function_homes(after_root, owned)
    after_keys = {f.key for f in after}
    by_task = {}
    for t in plan["tasks"]:
        b = [row["key"] for row in t["owned"]]
        a = sorted({k for k in b if k in after_keys} | {k for k, h in homes.items() if h == t["id"]})
        if touched & (set(b) | set(a)):
            by_task[t["id"]] = {"before": b, "after": a, "numbers": _numbers(before, after, set(b), set(a))}
    kb = {k for v in by_task.values() for k in v["before"]}
    ka = {k for v in by_task.values() for k in v["after"]}
    return {"tasks": sorted(by_task), "numbers": _numbers(before, after, kb, ka), "by_task": by_task,
            "untasked": sorted(touched - kb - ka)}


def _numbers(before: list, after: list, kb: set[str], ka: set[str]) -> list[dict]:
    return [dilution.measures([f for f in before if f.key in kb]), dilution.measures([f for f in after if f.key in ka])]
