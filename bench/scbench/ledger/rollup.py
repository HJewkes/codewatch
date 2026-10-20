"""The ledger's roll-ups (C-248 S5).

  types         per task type: tasks run, skips, accepted (kept: accepted and not reverted by the
                integration gate), pass rate, $ and $ per accepted task, projected against realised gain
  retirement    one row per type with its numbers; a type retires once it has RETIRE["min_tasks"] tasks
                and its pass rate or its realised/projected gain falls under the bar. The bars are
                provisional, the ledger's own, for C-249 to revisit; the frozen planner config is untouched.
  false_rejects per P5 family, the gate rejects later judged good (by T3 or the owner; an owner verdict
                wins), for E4's re-fit. The param-bag check is T2->T3 evidence only (it holds on 96.9% of
                reference helpers, short of 99%), so it is counted apart from the families.
"""

from __future__ import annotations

from collections import defaultdict

from ledger.columns import FAMILIES

RETIRE = {"min_tasks": 5, "pass_rate": 0.2, "gain_ratio": 0.25}


def _ratio(a: float, b: float) -> float | None:
    return round(a / b, 3) if b else None


def _type_row(rows: list[dict]) -> dict:
    ran = [r for r in rows if r["outcome"] != "skip"]
    kept = [r for r in ran if r["kept"]]
    usd = round(sum(r["usd"] for r in ran), 6)
    projected = sum(r["projected_gain"] or 0 for r in kept)
    realised = round(sum(r["realised_gain"] for r in kept), 1)
    return {"tasks": len(ran), "skipped": len(rows) - len(ran), "accepted": len(kept),
            "reverted": sum(bool(r["integration_revert"]) for r in ran), "pass_rate": _ratio(len(kept), len(ran)),
            "usd": usd, "usd_per_accepted": _ratio(usd, len(kept)), "projected_gain": round(projected, 1),
            "realised_gain": realised, "realised_over_projected": _ratio(realised, projected)}


def types(rows: list[dict]) -> dict:
    grouped = defaultdict(list)
    for r in rows:
        grouped[r["task_type"]].append(r)
    return {kind: _type_row(grouped[kind]) for kind in sorted(grouped)}


def _retire_why(t: dict) -> list[str]:
    if t["tasks"] < RETIRE["min_tasks"]:
        return []
    why = [f"pass rate {t['pass_rate']} < {RETIRE['pass_rate']}"] if t["pass_rate"] < RETIRE["pass_rate"] else []
    gain = t["realised_over_projected"]
    return why + ([f"realised/projected gain {gain} < {RETIRE['gain_ratio']}"]
                  if gain is not None and gain < RETIRE["gain_ratio"] else [])


def retirement(by_type: dict) -> list[dict]:
    return [{"type": kind, "tasks": t["tasks"], "pass_rate": t["pass_rate"],
             "realised_over_projected": t["realised_over_projected"], "usd_per_accepted": t["usd_per_accepted"],
             "retire": bool(why), "why": why}
            for kind, t in by_type.items() for why in [_retire_why(t)]]


def final_judgements(judged: list[dict]) -> dict[tuple[str, str], dict]:
    """The deciding judgement per (run, cluster): the owner's last, else T3's last."""
    out: dict[tuple[str, str], dict] = {}
    for j in judged:
        key = (j["run"], j["cluster"])
        if key not in out or j["by"] == "owner" or out[key]["by"] == "T3":
            out[key] = j
    return out


def _tally(rejects: list[dict], verdicts: dict) -> dict:
    good = [r for r in rejects if verdicts.get((r["run"], r["cluster"]), {}).get("good")]
    by = defaultdict(int)
    for r in good:
        by[verdicts[(r["run"], r["cluster"])]["by"]] += 1
    return {"rejects": len(rejects), "judged_good": len(good), "by": dict(sorted(by.items())),
            "clusters": sorted(f"{r['run']}/{r['cluster']}" for r in good)}


def false_rejects(rows: list[dict], judged: list[dict]) -> dict:
    verdicts = final_judgements(judged)
    rejects = [r for r in rows if r["outcome"] == "reject"]
    families = {f: _tally([r for r in rejects if f in r["families"]["failed"]], verdicts) for f in FAMILIES}
    bag = [r for r in rejects if r["gates"]["param_bag"]]
    return {"families": families, "evidence": {"param_bag": _tally(bag, verdicts)}}


def rollup(rows: list[dict], judged: list[dict]) -> dict:
    by_type = types(rows)
    return {"types": by_type, "retirement": retirement(by_type), "false_rejects": false_rejects(rows, judged)}
