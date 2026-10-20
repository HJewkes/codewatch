"""Feasibility, then rank (C-248 S3 step 3'): pick each task's edits by exhaustive search on end states.

  feasible  no constraint broken (endstate.py), positive own-body gain, gain per new function at or
            above the floor, and the P5 family tolerances hold. P4's module verdict is reported only.
  score     gain x U_width x U_cross x U_size, each utility in 0..1 from the config's reference bands:
            U_width   mean over new functions of a band on their parameter count (1 at p70, 0 at p90)
            U_cross   a band on the control crossings the edits add
            U_size    the smallest class-size band over touched classes, times the mean of a low-tail
                      band on new functions' own SLOC (tiny helpers fragment)
  search    every candidate is scored alone; of those with positive gain and no broken constraint (the
            floor and P5 may still pass in combination), the best max_candidates by (score, gain, id) enter an
            exhaustive search over their pairwise-compatible subsets, scored on the combined end state.
            Two edits are exclusive when they rewrite overlapping lines of one unit, or one removes a unit
            the other rewrites. The highest feasible score wins; ties go to fewer edits, then to ids.
"""

from __future__ import annotations

import ast
from itertools import combinations

from planner import endstate
from planner.inline import r4
from planner.recipes import Candidate, r1, r2, r3
from planner.units import Unit


def band(x: float, full: float, zero: float) -> float:
    """1 at or below `full`, 0 at or past `zero`, linear between."""
    if x <= full:
        return 1.0
    return 0.0 if x >= zero else (zero - x) / (zero - full)


def _helper(sloc: int, b: dict) -> float:
    if sloc >= b["full_at"]:
        return 1.0
    if sloc <= b["low_at"]:
        return b["low_value"]
    return b["low_value"] + (1 - b["low_value"]) * (sloc - b["low_at"]) / (b["full_at"] - b["low_at"])


def utilities(result: dict, after: endstate.State, cfg: dict) -> dict:
    u = cfg["utilities"]
    new = [after.units[k] for k in result["new"]]
    width = sum(band(n.params, *u["cut_in"]) for n in new) / len(new) if new else 1.0
    crossings = max(0, result["families"]["crossings"])
    classes = {after.units[k].cls for k in result["touched_after"] if after.units[k].cls}
    size = min((band(after.classes[c]["methods"], *u["class_methods"]) for c in classes), default=1.0)
    helpers = sum(_helper(n.sloc, u["helper_sloc"]) for n in new) / len(new) if new else 1.0
    return {"width": round(width, 3), "cross": round(band(crossings, *u["crossings"]), 3),
            "size": round(size * helpers, 3)}


def judge(result: dict, after: endstate.State, cfg: dict) -> dict:
    n, gain = len(result["new"]), result["gain"]
    why = list(result["violations"])
    why += ["no gain"] if gain <= 0 else []
    why += ["floor"] if n and gain / n < cfg["floor_gain_per_new_function"] else []
    why += [f"p5:{f}" for f in result["families"]["failed"]]
    util = utilities(result, after, cfg)
    score = gain * util["width"] * util["cross"] * util["size"] if not why else 0.0
    return {**result, "utilities": util, "rejected": why, "feasible": not why, "score": round(score, 1)}


def _regions(c: Candidate) -> dict[str, tuple[float, float]]:
    out = {c.unit: c.span}
    if c.recipe == "R4":
        out[c.detail["helper"]] = (0, float("inf"))
    return out


def exclusive(a: Candidate, b: Candidate) -> bool:
    ra, rb = _regions(a), _regions(b)
    return any(ra[k][0] <= rb[k][1] and rb[k][0] <= ra[k][1] for k in set(ra) & set(rb))


def candidates(owned: list[Unit], head: str, edges: dict, cfg: dict) -> list[Candidate]:
    hot = [u for u in owned if u.cc > cfg["hot_cc"]]
    out = [c for u in hot for c in r1(u, cfg) + r3(u, cfg)] + [c for u in owned for c in r2(u, cfg)]
    return sorted(out + r4(owned, head, edges), key=lambda c: c.id)


class Search:
    def __init__(self, rel: str, tree: ast.Module, trees: dict, cfg: dict):
        self.rel, self.tree, self.trees, self.cfg = rel, tree, trees, cfg
        self.before = endstate.measure(rel, tree)

    def score(self, cands: list[Candidate]) -> dict:
        after = endstate.measure(self.rel, endstate.apply(self.tree, cands))
        touches = {k for c in cands for k in c.touches}
        result = endstate.compare(self.rel, self.before, after, touches, self.trees, self.cfg)
        return {"edits": sorted(c.id for c in cands), "touches": sorted(touches), **judge(result, after, self.cfg)}

    def best(self, cands: list[Candidate]) -> tuple[list[dict], dict | None]:
        singles = [self.score([c]) for c in cands]
        order = sorted(range(len(cands)), key=lambda i: (-singles[i]["score"], -singles[i]["gain"], cands[i].id))
        pool = [cands[i] for i in order if singles[i]["gain"] > 0 and not singles[i]["violations"]]
        pool = pool[:self.cfg["search"]["max_candidates"]]
        best = None
        for r in range(1, len(pool) + 1):
            for subset in combinations(pool, r):
                if any(exclusive(a, b) for a, b in combinations(subset, 2)):
                    continue
                s = singles[cands.index(subset[0])] if r == 1 else self.score(list(subset))
                if s["feasible"] and (best is None or (s["score"], -len(s["edits"])) > (best["score"], -len(best["edits"]))):
                    best = s
        return singles, best


def _brief(s: dict) -> dict:
    return {k: s[k] for k in ("gain", "score", "feasible", "rejected")} | {"new_functions": len(s["new"])}


def plan_edits(task: dict, units: dict[str, Unit], edges: dict, trees: dict, cfg: dict) -> None:
    """Add the task's candidate edits, each scored alone, and the chosen set (or None)."""
    owned = [units[r["key"]] for r in task["owned"]]
    cands = candidates(owned, task["id"], edges, cfg)
    singles, best = Search(task["module"], trees[task["module"]], trees, cfg).best(cands) if cands else ([], None)
    task["candidates"] = [{**c.row(), **_brief(s)} for c, s in zip(cands, singles)]
    task["chosen"] = best
