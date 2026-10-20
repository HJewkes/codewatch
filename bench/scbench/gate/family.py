"""The one family gate (C-248 B8.3), shared by the implementer's self-check and the final gate.

`check` measures a change against its task: P5 per family, T1 on own-body CC, the constraints with their
evidence, and ownership (only owned units edited; the head's signature frozen). `render` prints it in the
one format the self-check shows and the retry message reuses: families with their own tolerances and one
line of constraint verdicts, detailed only where one is violated. It never prints a score, a weight, the
gain-per-new-function floor or a rank; those stay in the JSON for the final gate and the ledger.
"""

from __future__ import annotations

import ast
from pathlib import Path

from gate.measure import KINDS, measure_trees, sources
from planner.rank import band
from planner.units import module_units

EPS_KEY = "cx_improve"
DETAIL_KINDS = {**KINDS, "hidden_calls": "hidden calls", "classes": "classes", "modules": "modules"}


def _owner_problems(result: dict, task: dict, base: dict[str, str], head: dict[str, str]) -> list[str]:
    owned = {r["key"] for r in task.get("owned", [])}
    out = [f"edited a unit the task does not own: {k}" for k in result["touched_before"] if owned and k not in owned]
    head_key = task.get("id")
    if head_key and _signature(base, head_key) != _signature(head, head_key):
        out.append(f"changed the frozen head signature: {head_key}")
    return out


def _signature(texts: dict[str, str], key: str) -> str | None:
    rel = key.split(":", 1)[0]
    parsed = module_units(rel, texts[rel]) if rel in texts else None
    unit = next((u for u in parsed[1] if u.key == key), None) if parsed else None
    return ast.dump(unit.node.args) if unit else None


def utilities(result: dict, head: dict[str, str], cfg: dict) -> dict:
    """B7.6's graded utilities over the new functions (reported to the ledger, never shown)."""
    u, new = cfg["utilities"], result["new"]
    params = [_params(head, k) for k in new]
    width = sum(band(p, *u["cut_in"]) for p in params) / len(params) if params else 1.0
    crossings = max(0, result["families"]["crossings"])
    return {"width": round(width, 3), "cross": round(band(crossings, *u["crossings"]), 3)}


def _params(texts: dict[str, str], key: str) -> int:
    rel = key.split(":", 1)[0]
    return next(u.params for u in module_units(rel, texts[rel])[1] if u.key == key)


def check_trees(base: dict[str, str], head: dict[str, str], task: dict, cfg: dict) -> dict:
    result = measure_trees(base, head, cfg)
    ownership = _owner_problems(result, task, base, head)
    n = len(result["new"])
    floor = not n or result["gain"] / n >= cfg["floor_gain_per_new_function"]
    return {"task": task.get("id", ""), "recipe": task.get("recipe", ""), **result, "ownership": ownership,
            "utilities": utilities(result, head, cfg), "value": {"gain_positive": result["gain"] > 0, "floor": floor},
            "pass": result["t1"]["pass"] and result["families"]["pass"] and not ownership}


def check(base: Path, head: Path, task: dict, cfg: dict) -> dict:
    return check_trees(sources(base), sources(head), task, cfg)


def _line(name: str, before: float, delta: float, tol: str, verdict: str) -> str:
    return f"{name:<14}{before:>6.0f}      {delta:+.2f}       {tol:<12}{verdict}"


def _family_lines(report: dict, cfg: dict) -> list[str]:
    fam, p5 = report["families"], cfg["p5"]
    d, failed, eps = fam["deltas"], set(fam["failed"]), p5[EPS_KEY]
    before = fam.get("before", {})

    def word(family: str, delta: float) -> str:
        return "FAIL" if family in failed else "improved" if delta < -eps else "held"
    mod = fam["module"]
    return ["family        before   delta/SLOC   tolerance   verdict",
            _line("cx  cc", before.get("cc", 0), d["cc"], "improve", word("cx", d["cc"])),
            _line("cx  cognitive", before.get("cognitive", 0), d["cognitive"], "improve", word("cx", d["cognitive"])),
            _line("size", before.get("size", 0), d["size"], f"+{p5['size']:.2f}", word("size", d["size"])),
            _line("iface in", before.get("iface", 0), d["iface"], f"+{fam['iface_budget']:.2f}", word("iface", d["iface"])),
            f"{'iface cross':<14}{fam['crossings_before']:>6}      {fam['crossings']:+d}          +{p5['crossings']:<11}"
            f"{word('crossings', fam['crossings'])}",
            f"{'module':<14}({mod['lines']:+d} lines, {report['t1']['new_fns']} new fns)   {mod['allowed']} allowed   "
            f"{'FAIL' if 'module' in failed else 'held'}"]


def _constraint_lines(report: dict) -> list[str]:
    t1, found = report["t1"], report["constraints"]
    head = (f"T1 own ΔCC {t1['cc_added']:+d} <= {t1['new_fns']} new fns: {'ok' if t1['pass'] else 'FAIL'}; "
            + "; ".join(f"{label}: {'none' if kind not in found else 'FOUND'}" for kind, label in KINDS.items())
            + f"; ownership: {'only owned symbols edited' if not report['ownership'] else 'FAIL'}")
    out = [f"constraints   {head}"]
    for kind, label in DETAIL_KINDS.items():
        out += [f"              {label}: {item}" for item in found.get(kind, [])]
    return out + [f"              ownership: {item}" for item in report["ownership"]]


def render(report: dict, cfg: dict, result_line: str) -> str:
    """The shared self-check / retry-message format; `result_line` is the caller's verdict sentence."""
    before, after = report["sloc"]
    ratio = after / (before or 1)
    recipe = f"   recipe {report['recipe']}" if report.get("recipe") else ""
    lines = [f"task {report['task']}{recipe}   touched {before} -> {after} SLOC "
             f"({ratio:.2f}x, limit {cfg['p5']['amount_ratio']:.2f}x){'   FAIL' if 'amount' in report['families']['failed'] else ''}"]
    lines += _family_lines(report, cfg) + _constraint_lines(report)
    return "\n".join(lines + [f"result        {result_line}"]) + "\n"
