"""The cleanup stage's deterministic task planner (C-248 S3a): clusters, inner-first tasks, cut width.

No model calls. `python3 -m planner plan <tree>` prints the plan as JSON; see __main__.py.
"""

from __future__ import annotations

from pathlib import Path

from planner.calls import call_edges, merge_graph_db
from planner.tasks import TOKEN_CAP, plan_tasks
from planner.units import scan_tree


def graph(root: Path, graph_db: str | None = None):
    """Units by key and the call graph of the tree under root."""
    trees, units = scan_tree(root)
    edges = call_edges(trees, units)
    if graph_db:
        merge_graph_db(edges, graph_db)
    return {u.key: u for u in units}, edges


def plan_tree(root: Path, graph_db: str | None = None, cap: int = TOKEN_CAP) -> dict:
    units, edges = graph(root, graph_db)
    plan = plan_tasks(units, edges, cap)
    kinds = [kind for dsts in edges.values() for kind in dsts.values()]
    plan["graph"] = {"units": len(units), "calls": kinds.count("calls"), "dispatch": kinds.count("dispatch"),
                     "hot": sum(u.hot for u in units.values())}
    return plan
