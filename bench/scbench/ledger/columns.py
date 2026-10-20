"""A task's ledger row, built from the planner's task, the final gate's result and the run's own facts.

The S4 result carries the per-family deltas and P5 verdicts but not the tolerances they were judged
against, so `tolerances` reads them back from the frozen config and the result (the iface budget and the
module allowance are per change). The self-check log keeps only granted calls; a call refused past the
budget is a run fact (`refused`), so an overrun is visible only when the run reports it.
"""

from __future__ import annotations

import json
from pathlib import Path

from gate.__main__ import MAX_CALLS
from ledger.rules import digest, removed

FAMILIES = ("cx", "size", "iface", "crossings", "module", "amount")


def task_type(task: dict) -> str:
    """The task's recipes, from its chosen edits ("R1+R3"), or "none" when the planner chose nothing."""
    chosen = task.get("chosen") or {}
    by_id = {c["id"]: c["recipe"] for c in task.get("candidates", [])}
    recipes = sorted({by_id[e] for e in chosen.get("edits", []) if e in by_id})
    return "+".join(recipes) or task.get("recipe") or "none"


def tolerances(fam: dict, cfg: dict) -> dict:
    p5 = cfg["p5"]
    return {"cx": -p5["cx_improve"], "cx_worsen": p5["cx_worsen"], "size": p5["size"], "iface": fam["iface_budget"],
            "crossings": p5["crossings"], "module": fam["module"]["allowed"], "amount": p5["amount_ratio"]}


def family_columns(report: dict, cfg: dict) -> dict:
    fam = report["families"]
    deltas = {**fam["deltas"], "crossings": fam["crossings"], "module": fam["module"]["lines"], "amount": fam["amount"]}
    return {"deltas": deltas, "tolerances": tolerances(fam, cfg), "failed": fam["failed"]}


def self_check(log: Path | None, cluster: str, refused: int = 0) -> dict:
    """Granted calls from the gate's call log, plus the calls the run saw refused (exit 2)."""
    granted = json.loads(log.read_text()).get(cluster, 0) if log and log.is_file() else 0
    return {"calls": granted, "budget": MAX_CALLS, "refused": refused, "overrun": refused > 0}


def _param_bag(report: dict) -> bool:
    return any(": bag:" in item for item in report["constraints"].get("common", []))


def gates(result: dict, reinline: list[str]) -> dict:
    review = result.get("review") or {}
    tier = "T2" if reinline and result["outcome"] != "reject" else result["tier"]
    return {"outcome": "reject" if reinline else result["outcome"], "tier": tier, "reasons": result["reasons"] + reinline,
            "constraints": sorted(result["report"]["constraints"]), "param_bag": _param_bag(result["report"]),
            "t3": review.get("outcome"), "reinline": reinline}


def structural_cost(report: dict) -> dict:
    return {"new_fns": len(report["new"]), "module_lines": report["families"]["module"]["lines"],
            "sloc": report["sloc"]}


def _base(run: dict, task: dict) -> dict:
    return {"kind": "task", "run": run["id"], "task_type": task_type(task), "cluster": task["id"],
            "wave": task.get("wave"), "projected_gain": (task.get("chosen") or {}).get("gain"),
            "next_checkpoint": None}


def skip_row(run: dict, task: dict, reason: str) -> dict:
    return {**_base(run, task), "outcome": "skip", "reason": reason, "kept": False}


def task_row(run: dict, task: dict, result: dict, facts: dict, head: dict[str, str], cfg: dict,
             reinline: list[str] = ()) -> dict:
    """`facts`: usd, retry_used, calls_log, refused, integration_revert (None until the integration gate)."""
    report, verdict = result["report"], gates(result, list(reinline))
    revert = facts.get("integration_revert")
    review_usd = (result.get("review") or {}).get("usd", 0.0)
    return {**_base(run, task), "outcome": verdict["outcome"], "kept": verdict["outcome"] == "accept" and not revert,
            "realised_gain": report["gain"], "structural_cost": structural_cost(report),
            "usd": round(facts.get("usd", 0.0) + review_usd, 6), "gates": verdict,
            "retry_used": bool(facts.get("retry_used")), "families": family_columns(report, cfg),
            "self_check": self_check(facts.get("calls_log"), task["id"], facts.get("refused", 0)),
            "integration_revert": revert, "symbol": task["id"], "symbol_digest": digest(head, task["id"]),
            "new": report["new"], "removed": removed(report)}
