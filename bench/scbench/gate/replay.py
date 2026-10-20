"""python3 -m gate.replay <manifest.json> [--set p5.KEY=VALUE ...]: the false-reject replay (C-248 S4, owner R3-1).

The manifest names the inputs, all read only:
  pairs  [{set, id, base, head, good?, expect?}]  before/after trees, judged by the final gate's family
         check. `good` marks a pooled-good change; `expect` is B7.5's constraint verdict (labels below).
  folds  [{problem, cp, tree, groups: {head: [unit keys]}}]  reference clusters; each hot group (2+ units,
         one over hot_cc) is judged as its fold counterfactual (round 3, B8.1): before is the group
         folded into its head (CC and SLOC less one per call), after is the group as written. Rows are
         deduplicated per (problem, head, bodies), then the last checkpoint per (problem, head) is kept.
         Every non-head member is a reference helper interface for the constraint hold rates.

Labels: `T1`, one per constraint kind found (common, origins, pass_through, unused, hidden_calls, classes,
modules), `no gain`; none means feasible. A change bound for T3 counts as rejected here: no model calls.
End to end = T1, P5 and every constraint hold, gain > 0, and gain per new function >= the floor.
Prints one JSON summary of aggregates: counts and ids, no source text.
"""

from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import sys
from pathlib import Path

from gate.family import check
from planner import endstate
from planner.families import load_config, profile, verdict
from planner.units import scan_tree

HELPER_KINDS = ("common", "bag", "origins", "pass_through", "unused")


def labels(report: dict) -> list[str]:
    out = [] if report["t1"]["pass"] else ["T1"]
    out += sorted(report["constraints"])
    return out + (["no gain"] if report["gain"] <= 0 else [])


def end_to_end(report: dict) -> bool:
    return report["pass"] and not labels(report) and report["value"]["floor"]


def judge_pair(pair: dict, cfg: dict) -> dict:
    report = check(Path(pair["base"]), Path(pair["head"]), {}, cfg)
    return {"set": pair["set"], "id": pair["id"], "good": pair.get("good", False), "expect": pair.get("expect"),
            "labels": labels(report), "pareto": report["families"]["pass"], "failed": report["families"]["failed"],
            "end_to_end": end_to_end(report), "module": report["families"]["module"], "new": len(report["new"])}


def _fold_row(units: list, rows: list[dict], head: str) -> dict:
    n, h = len(units), next(r for u, r in zip(units, rows) if u.key == head)
    return {"cc": sum(r["cc"] for r in rows) - (n - 1), "cognitive": sum(r["cognitive"] for r in rows),
            "sloc": sum(r["sloc"] for r in rows) - (n - 1), "params": h["params"]}


def fold_verdict(state: endstate.State, head: str, keys: list[str], module_sloc: int, cfg: dict) -> dict:
    units = [state.units[k] for k in keys]
    rows = [endstate.row(u) for u in units]
    control = {k: len(state.found.get(k, {}).get("control", [])) for k in keys}
    n = len(keys)
    change = {"crossings": [control[head], sum(control.values())], "new_fns": n - 1,
              "modules": {"before": {"m": module_sloc - (n - 1)}, "after": {"m": module_sloc}}}
    return verdict(profile([_fold_row(units, rows, head)], cfg), profile(rows, cfg), change, cfg)


def _digest(node: ast.AST) -> str:
    return hashlib.sha1(ast.dump(node).encode()).hexdigest()[:12]


def _states(tree: Path) -> dict[str, endstate.State]:
    trees, _ = scan_tree(tree)
    return {rel: endstate.measure(rel, t) for rel, t in trees.items()}


def judge_folds(fold: dict, cfg: dict, seen: set, helpers: dict) -> list[dict]:
    states, rows = _states(Path(fold["tree"])), []
    for head, keys in sorted(fold["groups"].items()):
        rel = head.split(":", 1)[0]
        state = states.get(rel)
        if not state or not all(k in state.units for k in keys) or max(state.units[k].cc for k in keys) <= cfg["hot_cc"]:
            continue
        for k in keys:
            if k != head:
                helpers[(fold["problem"], k, _digest(state.units[k].node))] = state.found.get(k, {})
        sig = (fold["problem"], head, tuple(sorted(_digest(state.units[k].node) for k in keys)))
        if sig in seen:
            continue
        seen.add(sig)
        msl = sum(u.sloc for u in state.units.values())
        v = fold_verdict(state, head, keys, msl, cfg)
        rows.append({"problem": fold["problem"], "cp": fold["cp"], "head": head, "pass": v["pass"],
                     "failed": v["failed"], "new": len(keys) - 1})
    return rows


def last_per_head(rows: list[dict]) -> list[dict]:
    best: dict = {}
    for r in rows:
        key = (r["problem"], r["head"])
        if key not in best or r["cp"] > best[key]["cp"]:
            best[key] = r
    return [best[k] for k in sorted(best)]


def _split_bag(found: dict) -> dict:
    """Interface-level common coupling apart from the parameter bag, a caller-level check (B2, B7.3)."""
    common = found.get("common", [])
    return {**found, "common": [c for c in common if not c.startswith("bag:")],
            "bag": [c for c in common if c.startswith("bag:")]}


def helper_rates(helpers: dict) -> dict:
    helpers = {k: _split_bag(f) for k, f in helpers.items()}
    n = len(helpers)
    return {"n": n, **{k: {"fires": sum(bool(f.get(k)) for f in helpers.values()),
                           "holds": round(1 - sum(bool(f.get(k)) for f in helpers.values()) / (n or 1), 4)}
                       for k in HELPER_KINDS}}


def _tally(rows: list[dict], ok: str) -> dict:
    return {"accept": sum(r[ok] for r in rows), "n": len(rows),
            "rejected": sorted([r["id"], r["failed"]] for r in rows if not r[ok])}


def summarise(pairs: list[dict], folds: list[dict], helpers: dict) -> dict:
    distinct = [{**r, "id": f"{r['problem']}/{r['cp']}/{r['head']}"} for r in last_per_head(folds)]
    good = [r for r in pairs if r["good"]]
    c246 = [r for r in good if r["set"] == "c246"]
    old = [r for r in pairs if r["set"] == "old"]
    rejected = len(distinct) - sum(r["pass"] for r in distinct) + len(good) - sum(r["pareto"] for r in good)
    pooled = len(distinct) + len(good)
    return {"ref_folds_all": len(folds), "ref_distinct": _tally(distinct, "pass"), "c246_accepted": _tally(c246, "pareto"),
            "c246_all": _tally([r for r in pairs if r["set"] == "c246"], "pareto"),
            "pooled_good": {"rejected": rejected, "n": pooled, "share": round(rejected / (pooled or 1), 4)},
            "old_pareto": _tally(old, "pareto"), "old_end_to_end": sorted(r["id"] for r in old if r["end_to_end"]),
            "old_b75": {"match": sum(r["labels"] == r["expect"] for r in old if r["expect"] is not None),
                        "n": sum(r["expect"] is not None for r in old),
                        "differs": sorted([r["id"], r["labels"], r["expect"]] for r in old
                                          if r["expect"] is not None and r["labels"] != r["expect"])},
            "old_module": {r["id"]: [r["module"]["lines"], r["new"]] for r in old},
            "helpers": helper_rates(helpers)}


def replay(manifest: dict, cfg: dict) -> dict:
    pairs = [judge_pair(p, cfg) for p in manifest.get("pairs", [])]
    seen: set = set()
    helpers: dict = {}
    folds = [row for f in manifest.get("folds", []) for row in judge_folds(f, cfg, seen, helpers)]
    return summarise(pairs, folds, helpers)


def override(cfg: dict, settings: list[str]) -> dict:
    out = copy.deepcopy(cfg)
    for item in settings:
        path, value = item.split("=", 1)
        *parents, leaf = path.split(".")
        node = out
        for key in parents:
            node = node[key]
        node[leaf] = json.loads(value) if value[:1] in "-0123456789[{" else value
    return out


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python3 -m gate.replay")
    p.add_argument("manifest", type=Path)
    p.add_argument("--set", action="append", default=[], dest="settings", help="config override, KEY.PATH=VALUE")
    a = p.parse_args(argv)
    cfg = override(load_config(), a.settings)
    print(json.dumps({"config": cfg["version"], "overrides": a.settings,
                      **replay(json.loads(a.manifest.read_text()), cfg)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
