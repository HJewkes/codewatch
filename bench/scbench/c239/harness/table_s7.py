"""table_s7.py <S7 runs dir> <C-246 runs dir> <C-246 cleanup dir>: the C-248 S7 NEW vs C-246 table (markdown).

Per seed and pooled: hidden regressions (the regrade, eval mode), all five gates as table_c246.py counts
them (an unknown gate, `?`, is not a failure), Δ total CC, the dilution-proof numbers (dilution.py via cleanup_report.py: high-CC mass, CC>10
count, max CC, tree), single-caller Δ, $, and from every session's run.json: sessions, no-op sessions
(tree unchanged), no-op sessions the gate accepted (a defect: the E2 parity lesson), retries, retries whose session left the tree unchanged, diffgate cases left
inconclusive by a timeout (counted per attempt, C-255) and rejects whose only differences were stderr.
The C-246 dilution numbers come from frozen cpN against frozen cpN + its change.diff.
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

GATES = ("hidden", "growth", "helpers", "tests", "diff")


def _json(path: Path) -> dict:
    return json.loads(path.read_text()) if path.is_file() else {}


def _stderr_only(attempt_dir: Path) -> bool:
    gate = _json(attempt_dir / "diffgate" / "gate.json")
    left = [d for d in gate.get("differences", []) if d.get("status") == "differs"
            and "timeout" not in ((d.get("base") or {}).get("rc"), (d.get("head") or {}).get("rc"))]
    return bool(left) and all(d.get("fields") == ["stderr"] for d in left)


def sessions(cleanup: Path) -> dict:
    """Counts over every session attempt in the run, read from its run.json and final.json."""
    out = {"sessions": 0, "noop": 0, "noop_accepts": 0, "retries": 0, "noop_retries": 0, "inconclusive": 0,
           "stderr_rejects": 0}
    for facts_file in sorted(cleanup.glob("wave*/*/a*/run.json")):
        facts, final = _json(facts_file), _json(facts_file.parent / "final.json")
        retry = facts_file.parent.name != "a1"
        out["sessions"] += 1
        out["noop"] += not facts.get("changed_files")
        out["noop_accepts"] += final.get("outcome") == "accept" and not facts.get("changed_files")
        out["retries"] += retry
        out["noop_retries"] += retry and not facts.get("changed_files")
        out["inconclusive"] += final.get("diffgate_inconclusive", 0)
        out["stderr_rejects"] += final.get("outcome") == "reject" and _stderr_only(facts_file.parent)
    return out


def load(run: Path) -> dict | None:
    g = _json(run / "gates.json")
    if not g:
        return None
    dg = _json(run / "diffgate" / "gate.json")
    return {"gates": {**g["gates"], "diff": dg.get("pass")}, "cc": g["cc_total"], "single": g["single_caller"],
            "usd": _json(run / "result.json").get("total_cost_usd") or 0.0}


def pct(before: float, after: float) -> float:
    return (after - before) / max(before, 1) * 100


def side(run: dict | None, tree: list | None) -> dict | None:
    if not run or not tree:
        return None
    b, a = tree
    return {**run, "all": all(v is not False for v in run["gates"].values()), "dcc": pct(*run["cc"]),
            "dmass": pct(b["mass"], a["mass"]), "dcount": a["count"] - b["count"], "dmax": a["max"] - b["max"],
            "dsingle": (run["single"][1] or 0) - (run["single"][0] or 0), "tree": (b, a)}


def cell(x: dict | None, key: str, fmt: str) -> str:
    return "–" if x is None else format(x[key], fmt)


def row(key: str, new: dict | None, old: dict | None, s: dict) -> str:
    gates = "–" if new is None else "".join({True: g[0], False: "✗"}.get(v, "?") for g, v in new["gates"].items())
    dil = "–" if new is None else "{0[mass]:.0f}·{0[count]}·{0[max]} → {1[mass]:.0f}·{1[count]}·{1[max]}".format(*new["tree"])
    return (f"| {key} | {gates} | {cell(new, 'all', '')} / {cell(old, 'all', '')} | {cell(new, 'dcc', '+.1f')} / "
            f"{cell(old, 'dcc', '+.1f')} | {cell(new, 'dmass', '+.1f')} / {cell(old, 'dmass', '+.1f')} | {dil} | "
            f"{cell(new, 'dsingle', '+d')} / {cell(old, 'dsingle', '+d')} | {s['sessions']} | {s['noop']} ({s['noop_accepts']}) | "
            f"{s['retries']} ({s['noop_retries']}) | {s['inconclusive']} | {s['stderr_rejects']} | "
            f"{cell(new, 'usd', '.2f')} / {cell(old, 'usd', '.2f')} |")


def med(xs: list[dict], key: str) -> str:
    vals = [x[key] for x in xs]
    return f"{statistics.median(vals):+.1f}" if vals else "–"


def pooled(label: str, xs: list[dict]) -> str:
    hidden = sum(x["gates"]["hidden"] is False for x in xs)
    return (f"- {label}: runs {len(xs)}; hidden regressions {hidden}; all-gate pass {sum(x['all'] for x in xs)}/{len(xs)}; "
            f"median Δ total CC {med(xs, 'dcc')}%; median Δ high-CC mass {med(xs, 'dmass')}%; "
            f"median Δ CC>10 count {med(xs, 'dcount')}; median Δ max CC {med(xs, 'dmax')}; "
            f"single-caller Δ total {sum(x['dsingle'] for x in xs):+d} (median {med(xs, 'dsingle')}); "
            "gate failures " + ", ".join(f"{g} {sum(x['gates'][g] is False for x in xs)}" for g in GATES)
            + f"; $ total {sum(x['usd'] for x in xs):.2f}")


def main(new_dir: str, old_dir: str, old_cleanup: str) -> int:
    keys = sorted(p.name for p in Path(old_dir).iterdir() if p.is_dir())
    news, olds, totals = [], [], {}
    print("| seed | NEW gates h/g/h/t/d | all-gate NEW / C-246 | Δ total CC % | Δ high-CC mass % | NEW mass·CC>10·max |"
          " single-caller Δ | sessions | no-op (accepted) | retries (no-op) | inconclusive | stderr-only rejects | $ NEW / C-246 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for key in keys:
        run = Path(new_dir) / key
        new = side(load(run), _json(run / "cleanup.json").get("tree"))
        old = side(load(Path(old_dir) / key), _json(Path(old_cleanup) / f"{key}.json").get("tree"))
        s = sessions(run / "cleanup")
        totals = {k: totals.get(k, 0) + v for k, v in s.items()}
        print(row(key, new, old, s))
        news += [new] if new else []
        olds += [old] if old else []
    print()
    print(pooled("NEW (S7)", news))
    print(pooled("C-246", olds))
    print("- sessions (NEW): " + ", ".join(f"{k} {v}" for k, v in totals.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
