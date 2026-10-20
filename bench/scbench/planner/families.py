"""Measure families and the P5 tolerances (C-248 B8.1), with P4's module rule as a shadow column.

Each unit measure maps to risk through a piecewise-linear curve with knots (min, 0), (p70, 1), (p80, 2)
and (p90, 3); past p90 the last slope continues, capped. A repeated knot is a step just past it.
A family's score is the sum of SLOC x risk over the touched set, and its delta is (after - before)
divided by the touched SLOC before. Control crossings are a count; module growth is in lines.

P5 (owner R3-2 and R3-3): cx improves and does not worsen; size holds; interface risk may rise by at
most iface_base + iface_ratio x gain, gain being the mean drop of cx CC and cx cognitive; crossings rise
by at most one; a module grows by at most module_lines_per_new_function lines per new function, or else
its risk (module SLOC x risk, plus class SLOC x risk of its method count) rises by at most module_risk per
module SLOC before (`module_risk_basis` "module", as round 3 measured it) or per touched SLOC before
("touched"); touched SLOC grows at most amount_ratio times. P4 charges module risk per new function
instead. Its verdict is reported and never gates.

Tolerances are frozen in config.json (version s4-1, C-248 S4): the cognitive knots are re-derived on the
validated own-body cognitive (calibration/cognitive.py) over 978 distinct reference functions, LOC-weighted
p70/p80/p90 15/23/34; round 3's 13/18/29 came from an approximate port. The other knots reproduce round 3.
"""

from __future__ import annotations

import json
from pathlib import Path

CONFIG = Path(__file__).with_name("config.json")
MEASURES = {"cc": "cc", "cognitive": "cognitive", "size": "sloc", "iface": "params"}


def load_config(path: Path | None = None) -> dict:
    return json.loads((path or CONFIG).read_text())


def risk(x: float, knots: list[float], cap: float) -> float:
    if x <= knots[0]:
        return 0.0
    for i in range(1, len(knots)):
        if x <= knots[i]:
            lo, hi = knots[i - 1], knots[i]
            return float(i) if hi == lo else i - 1 + (x - lo) / (hi - lo)
    slope = 1 / (knots[-1] - knots[-2]) if knots[-1] > knots[-2] else 1.0
    return min(cap, len(knots) - 1 + (x - knots[-1]) * slope)


def profile(units: list[dict], cfg: dict) -> dict:
    """Family risk-SLOC over units given as {cc, cognitive, sloc, params}, plus their SLOC."""
    knots, cap = cfg["risk"]["knots"], cfg["risk"]["cap"]
    out = {fam: sum(u["sloc"] * risk(u[m], knots[m], cap) for u in units) for fam, m in MEASURES.items()}
    return {**out, "sloc": sum(u["sloc"] for u in units)}


def module_risk(lines: dict[str, int], cfg: dict, classes: dict[str, list[int]] | None = None) -> float:
    """Module SLOC x risk, plus, per class given as [SLOC, methods], class SLOC x risk of its methods."""
    knots, cap = cfg["risk"]["knots"], cfg["risk"]["cap"]
    mods = sum(n * risk(n, knots["module_sloc"], cap) for n in lines.values())
    return mods + sum(sl * risk(m, knots["class_methods"], cap) for sl, m in (classes or {}).values())


def deltas(before: dict, after: dict) -> dict:
    base = before["sloc"] or 1
    return {fam: round((after[fam] - before[fam]) / base, 3) for fam in MEASURES}


def iface_budget(d: dict, p5: dict) -> float:
    gain = max(0.0, -(d["cc"] + d["cognitive"]) / 2)
    return round(p5["iface_base"] + p5["iface_ratio"] * gain, 3)


def _module(change: dict, new_fns: int, cfg: dict, touched: float) -> dict:
    grown = sum(change["after"].values()) - sum(change["before"].values())
    base = sum(change["before"].values()) or 1 if cfg["p5"]["module_risk_basis"] == "module" else touched
    classes = change.get("classes") or {"before": {}, "after": {}}
    risen = (module_risk(change["after"], cfg, classes["after"]) - module_risk(change["before"], cfg, classes["before"])) / base
    p5, p4 = cfg["p5"], cfg["p4_shadow"]
    allowed = p5["module_lines_per_new_function"] * new_fns
    return {"lines": grown, "allowed": allowed, "risk": round(risen, 3),
            "p5": grown <= allowed or risen <= p5["module_risk"],
            "p4_shadow": risen <= p4["module_risk_base"] + p4["module_risk_per_new_function"] * new_fns}


def verdict(before: dict, after: dict, change: dict, cfg: dict) -> dict:
    """Per-family deltas against P5 tolerances. `change` carries crossings, new_fns, module lines and
    (optionally) touched classes as {before, after: {name: [SLOC, methods]}} under change["modules"]["classes"]."""
    p5, d = cfg["p5"], deltas(before, after)
    budget = iface_budget(d, p5)
    crossings = change["crossings"][1] - change["crossings"][0]
    module = _module(change["modules"], change["new_fns"], cfg, before["sloc"] or 1)
    amount = round(after["sloc"] / (before["sloc"] or 1), 3)
    checks = {
        "cx": (d["cc"] < -p5["cx_improve"] or d["cognitive"] < -p5["cx_improve"])
        and max(d["cc"], d["cognitive"]) <= p5["cx_worsen"],
        "size": d["size"] <= p5["size"],
        "iface": d["iface"] <= budget,
        "crossings": crossings <= p5["crossings"],
        "module": module["p5"],
        "amount": amount <= p5["amount_ratio"],
    }
    return {"before": {fam: round(before[fam], 1) for fam in MEASURES}, "crossings_before": change["crossings"][0],
            "deltas": d, "iface_budget": budget, "crossings": crossings, "module": module, "amount": amount,
            "checks": checks, "failed": sorted(k for k, ok in checks.items() if not ok),
            "pass": all(checks.values()), "p4_shadow": module["p4_shadow"]}
