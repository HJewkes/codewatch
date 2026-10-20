"""The wave scheduler (C-248 S6, B8.5): which tasks run next, re-planned from the current tree.

Wave 1 is shared work: the tasks the plan marks `shared` (an edit to a callee two clusters share) run
there, one lane, before any cluster task; on a plan with none it is empty. Then the cluster tasks run
inner-first: each later wave is the pending tasks at the lowest plan wave, on up to LANES concurrent
lanes. The tree is planned again before each wave, so a wave sees its inner heads as the earlier waves
left them; a task whose head has gone or cooled is no longer pending.
"""

from __future__ import annotations

LANES = 4


def pending(plan: dict, done: set[str], only: set[str] | None = None) -> list[dict]:
    return sorted((t for t in plan["tasks"] if t["id"] not in done and (only is None or t["id"] in only)),
                  key=lambda t: t["id"])


def shared_wave(plan: dict, only: set[str] | None = None) -> dict:
    return {"kind": "shared", "plan_wave": None, "lanes": 1,
            "tasks": [t for t in pending(plan, set(), only) if t.get("shared")]}


def next_wave(plan: dict, done: set[str], only: set[str] | None = None) -> dict | None:
    """{kind: cluster, plan_wave, lanes, tasks} for the next inner-first wave, or None when none is left."""
    left = [t for t in pending(plan, done, only) if not t.get("shared")]
    if not left:
        return None
    low = min(t["wave"] for t in left)
    tasks = [t for t in left if t["wave"] == low]
    return {"kind": "cluster", "plan_wave": low, "lanes": min(LANES, len(tasks)), "tasks": tasks}


def runnable(task: dict) -> str | None:
    """Why a task gets no session (the planner chose no edit), or None."""
    if task.get("chosen"):
        return None
    reasons = sorted({r for c in task.get("candidates", []) for r in c.get("rejected", [])})
    return "no feasible edit: " + ", ".join(reasons or ["no candidate edit"])
