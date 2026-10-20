"""A task's end state under a set of candidate edits, measured against its before state.

Both states are measured on `ast.unparse` text, so formatting never counts as a change. The touched set
is the units an edit rewrites or removes plus every unit the edits add. Measures are own-body:
  gain     own-body high-CC mass removed: sum over CC > hot_cc of CC x sqrt(SLOC), before minus after
  T1       own-body CC added over the touched set is at most the new functions (+ t1_margin)
  new      detector findings over the touched set that the end state has more of than the before state:
           common coupling, flag origins, pass-through, unused params or locals, temporary fields; plus
           touched classes over the LCOM4 limit that got worse, and new import cycles and SDP breaks
"""

from __future__ import annotations

import ast
import copy
import math
from dataclasses import dataclass

from calibration.cognitive import cognitive
from planner.calls import call_edges
from planner.classes import class_facts
from planner.detect import detect
from planner.families import profile, verdict
from planner.modules import structure, violations
from planner.units import Unit, dilution, module_units

COUNTED = ("common", "origins", "pass_through", "unused")


@dataclass
class State:
    tree: ast.Module
    units: dict[str, Unit]
    found: dict[str, dict[str, list[str]]]
    classes: dict[str, dict]
    sloc: int


def measure(rel: str, tree: ast.Module) -> State:
    text = ast.unparse(tree)
    parsed, units = module_units(rel, text)
    exempt = {d for dsts in call_edges({rel: parsed}, units).values() for d, kind in dsts.items() if kind == "dispatch"}
    return State(parsed, {u.key: u for u in units}, detect(parsed, units, exempt), class_facts(parsed),
                 len(dilution.sloc_lines(text, parsed)))


def row(u: Unit) -> dict:
    return {"cc": u.cc, "cognitive": cognitive(u.node, own_body=True), "sloc": u.sloc, "params": u.params}


def mass(units: list[Unit], hot: int) -> float:
    return sum(u.cc * math.sqrt(u.sloc) for u in units if u.cc > hot)


def apply(tree: ast.Module, cands: list) -> ast.Module:
    out = copy.deepcopy(tree)
    for c in sorted(cands, key=lambda c: c.id):
        c.apply(out)
    return ast.fix_missing_locations(out)


def _count(state: State, keys: set[str], kind: str) -> int:
    return sum(len(state.found[k][kind]) for k in keys if k in state.found)


def _imports(tree: ast.Module) -> list[str]:
    return [ast.dump(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]


def _module_breaks(before: State, after: State, rel: str, trees: dict, cfg: dict) -> dict:
    if _imports(before.tree) == _imports(after.tree):
        return {"cycles": [], "sdp": []}
    return violations(structure(trees), structure({**trees, rel: after.tree}), cfg["constraints"]["sdp_max_delta_i"])


def _class_breaks(before: State, after: State, touched: list[Unit], limit: int) -> list[str]:
    out = []
    for name in sorted({u.cls for u in touched if u.cls}):
        old, new = before.classes.get(name, {"lcom4": 0, "temporary": []}), after.classes.get(name)
        if new and new["lcom4"] > limit and new["lcom4"] > old["lcom4"]:
            out.append(f"lcom4:{name}={new['lcom4']}")
        out += [f"temporary:{name}.{a}" for a in new["temporary"] if a not in old["temporary"]] if new else []
    return out


def violated(before: State, after: State, kb: set[str], ka: set[str], new_fns: int, cfg: dict) -> list[str]:
    out = [k for k in COUNTED if _count(after, ka, k) > _count(before, kb, k)]
    grew = sum(after.units[k].cc for k in ka) - sum(before.units[k].cc for k in kb)
    if grew > new_fns + cfg["constraints"]["t1_margin"]:
        out.append(f"T1:+{grew}>{new_fns}")
    touched = [before.units[k] for k in kb] + [after.units[k] for k in ka]
    return out + _class_breaks(before, after, touched, cfg["constraints"]["lcom4_max"])


def class_rows(state: State, touched: list[Unit]) -> dict[str, list[int]]:
    """Touched classes as [own SLOC of their methods, method count], the class part of the mod family."""
    names = {u.cls for u in touched if u.cls and u.cls in state.classes}
    return {c: [sum(u.sloc for u in state.units.values() if u.cls == c), state.classes[c]["methods"]] for c in sorted(names)}


def compare(rel: str, before: State, after: State, touches: set[str], trees: dict, cfg: dict) -> dict:
    new = sorted(set(after.units) - set(before.units))
    kb = (touches | set(new)) & set(before.units)
    ka = (touches | set(new)) & set(after.units)
    bad = violated(before, after, kb, ka, len(new), cfg)
    touched = [before.units[k] for k in kb] + [after.units[k] for k in ka]
    breaks = _module_breaks(before, after, rel, trees, cfg)
    bad += [f"cycle:{'>'.join(c)}" for c in breaks["cycles"]] + [f"sdp:{s}>{d}" for s, d, _ in breaks["sdp"]]
    change = {"crossings": [_count(before, kb, "control"), _count(after, ka, "control")], "new_fns": len(new),
              "modules": {"before": {rel: before.sloc}, "after": {rel: after.sloc},
                          "classes": {"before": class_rows(before, touched), "after": class_rows(after, touched)}}}
    fam = verdict(profile([row(before.units[k]) for k in sorted(kb)], cfg),
                  profile([row(after.units[k]) for k in sorted(ka)], cfg), change, cfg)
    hot = cfg["hot_cc"]
    gain = mass([before.units[k] for k in kb], hot) - mass([after.units[k] for k in ka], hot)
    return {"new": new, "touched_before": sorted(kb), "touched_after": sorted(ka), "violations": bad,
            "gain": round(gain, 1), "families": fam}
