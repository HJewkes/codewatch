"""The cleanup stage's deterministic task planner: clusters, inner-first tasks and cut width (C-248 S3a);
recipes, feasibility, rank and the plan template (S3b).

No model calls. `python3 -m planner plan <tree>` prints the plan as JSON; see __main__.py.
"""

from __future__ import annotations

from pathlib import Path

from planner.calls import call_edges, merge_graph_db
from planner.families import load_config
from planner.rank import plan_edits
from planner.tasks import TOKEN_CAP, plan_tasks
from planner.template import render
from planner.units import scan_tree


def scan(root: Path, graph_db: str | None = None):
    """Module trees, units by key and the call graph of the tree under root."""
    trees, units = scan_tree(root)
    edges = call_edges(trees, units)
    if graph_db:
        merge_graph_db(edges, graph_db)
    return trees, {u.key: u for u in units}, edges


def graph(root: Path, graph_db: str | None = None):
    """Units by key and the call graph of the tree under root."""
    return scan(root, graph_db)[1:]


def plan_tree(root: Path, graph_db: str | None = None, cap: int = TOKEN_CAP, cfg: dict | None = None,
              label: str = "", edits: bool = True) -> dict:
    trees, units, edges = scan(root, graph_db)
    cfg = cfg or load_config()
    plan = plan_tasks(units, edges, cap)
    for task in plan["tasks"] if edits else ():
        plan_edits(task, units, edges, trees, cfg)
        task["template"] = render(task, cfg, label, len(plan["waves"]))
    plan["config"] = cfg["version"] if edits else None
    kinds = [kind for dsts in edges.values() for kind in dsts.values()]
    plan["graph"] = {"units": len(units), "calls": kinds.count("calls"), "dispatch": kinds.count("dispatch"),
                     "hot": sum(u.hot for u in units.values())}
    return plan
