"""table_c246.py <runs dir> <problems dir>: the C-246 per-problem table and distribution summary (markdown).

One row per finished run (gates.json present): hidden before/after, ex-tests erosion (legacy, reported
for comparability) and verbosity, total cyclomatic (graph.db, the growth gate's number), source code-line
delta, the tree's high-CC mass, CC>10 count and max CC from cleanup.json (– when the run has none),
test:source, the four gates plus the C-242 in-loop diff gate, and cost. Then median and IQR of the
deltas, the share of runs improving ex-tests erosion, the failure rate of each gate, and cost per run.
"""

import json
import statistics
import sys
from pathlib import Path

import yaml

GATES = ("hidden", "growth", "helpers", "tests", "diff")


def load(run: Path, problems: Path) -> dict | None:
    if not (run / "gates.json").is_file():
        return None
    g = json.loads((run / "gates.json").read_text())
    r = json.loads((run / "regrade.json").read_text())
    dg = json.loads((run / "diffgate" / "gate.json").read_text()) if (run / "diffgate" / "gate.json").is_file() else {}
    res = json.loads((run / "result.json").read_text() or "{}")
    cfg = yaml.safe_load((problems / r["problem"] / "config.yaml").read_text())
    b, a = r["before"], r["after"]
    return {"key": run.name, "n": r["checkpoint"], "tier": str(cfg.get("difficulty", "?"))[0],
            "hidden": (b["hidden"]["passed"], a["hidden"]["passed"], b["hidden"]["total"]),
            "ex": (b["erosion_ex_tests"], a["erosion_ex_tests"]), "vx": (b["verbosity_ex_tests"], a["verbosity_ex_tests"]),
            "cc": tuple(g["cc_total"]), "net": g["src_net"], "add": g["src_added"], "rem": g["src_removed"],
            "dil": json.loads((run / "cleanup.json").read_text())["tree"] if (run / "cleanup.json").is_file() else None,
            "ts": tuple(g["test_src"]),
            "gates": {**g["gates"], "diff": dg.get("pass")}, "diffs": dg.get("distinct_differences"),
            "usd": res.get("total_cost_usd") or 0.0}


def fmt_gates(gates: dict) -> str:
    return " ".join(f"{k[0]}{'✓' if v else ('✗' if v is False else '?')}" for k, v in gates.items() if k in GATES[1:])


def dilution(x: dict) -> str:
    if not x["dil"]:
        return "–"
    b, a = x["dil"]
    return f"{b['mass']:.0f} · {b['count']} · {b['max']} → {a['mass']:.0f} · {a['count']} · {a['max']}"


def row(x: dict) -> str:
    hb, ha, ht = x["hidden"]
    cc0, cc1 = x["cc"]
    return (f"| {x['key']} cp{x['n']} | {x['tier']} | {hb}/{ht} → {ha}/{ht} | {x['ex'][0]:.3f} → {x['ex'][1]:.3f} | "
            f"{x['vx'][0]:.3f} → {x['vx'][1]:.3f} | {cc0:g} → {cc1:g} ({(cc1 - cc0) / max(cc0, 1):+.0%}) | "
            f"{x['net']:+d} (+{x['add']}/-{x['rem']}) | {dilution(x)} | {x['ts'][0]:.2f} → {x['ts'][1]:.2f} | "
            f"{fmt_gates(x['gates'])} ({x['diffs']}) | {'pass' if x['gates']['hidden'] else 'FAIL'} | {x['usd']:.2f} |")


def spread(values: list[float], fmt: str) -> str:
    if len(values) < 2:
        return "n<2"
    q1, med, q3 = statistics.quantiles(values, n=4, method="inclusive")
    return f"median {med:{fmt}}, IQR {q1:{fmt}} to {q3:{fmt}}, range {min(values):{fmt}} to {max(values):{fmt}}"


def summary(rows: list[dict]) -> list[str]:
    n = len(rows)
    ex = [x["ex"][1] - x["ex"][0] for x in rows]
    vx = [x["vx"][1] - x["vx"][0] for x in rows]
    cc = [(x["cc"][1] - x["cc"][0]) / max(x["cc"][0], 1) * 100 for x in rows]
    mass = [(a["mass"] - b["mass"]) / max(b["mass"], 1) * 100 for b, a in (x["dil"] for x in rows if x["dil"])]
    out = [f"- runs: {n}",
           f"- high-CC mass Δ% (tree): {spread(mass, '+.1f')}; fell in {sum(d < 0 for d in mass)}/{len(mass)} with cleanup.json",
           f"- eros-xT Δ (legacy, reported for comparability): {spread(ex, '+.3f')}; improved in {sum(d < 0 for d in ex)}/{n} "
           f"({sum(d < 0 for d in ex) / n:.0%}), worse in {sum(d > 0 for d in ex)}/{n}",
           f"- verb-xT Δ: {spread(vx, '+.3f')}; improved in {sum(d < 0 for d in vx)}/{n}",
           f"- total cc Δ%: {spread(cc, '+.1f')}; fell in {sum(d < 0 for d in cc)}/{n}",
           f"- src code lines Δ: {spread([float(x['net']) for x in rows], '+.0f')}",
           "- gate failures: " + ", ".join(f"{g} {sum(x['gates'][g] is False for x in rows)}/{n}" for g in GATES)
           + f"; any gate {sum(not all(x['gates'][g] is not False for g in GATES) for x in rows)}/{n}",
           f"- cost per run: {spread([x['usd'] for x in rows], '.2f')}; total ${sum(x['usd'] for x in rows):.2f}"]
    return out


def main(runs_dir: str, problems_dir: str) -> int:
    rows = [x for p in sorted(Path(runs_dir).iterdir()) if (x := load(p, Path(problems_dir)))]
    print("| run | tier | hidden | eros-xT (legacy) | verb-xT | total cc | src lines Δ (+/-) | mass · CC>10 · max | t:src | "
          "gates g/h/t/d (diffs) | hidden gate | $ |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for x in sorted(rows, key=lambda x: ("EMH".find(x["tier"]), x["key"])):
        print(row(x))
    print()
    print("\n".join(summary(rows)))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]))
