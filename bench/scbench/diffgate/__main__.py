"""python -m diffgate replay|verdict: the C-242 behaviour-differential gate (see compare.py for the rules).

  replay  --cases DIR --base ROOT --head ROOT --python PY --scratch DIR --out runs.json [--generate]
          (inside the container) add generated cases, then run every case on base twice and head once
  verdict --cases DIR --runs runs.json --out gate.json [--regrade regrade.json] [--waivers FILE]
          [--spec-dir DIR]   pass/fail plus every difference, with base/head excerpts
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from .compare import normalise, verdict
from .mutate import generate
from .replay import load_cases, replay

EXCERPT = 400


def _replay(args) -> int:
    if args.generate:
        for name in [n for n, c in load_cases(args.cases).items() if c.get("source") != "generated"]:
            generate(args.cases / name, args.cases)
    runs = {}
    for side, root in (("base", args.base), ("base_again", args.base), ("head", args.head)):
        shutil.rmtree(args.scratch / side, ignore_errors=True)
        runs[side] = replay(args.cases, root, args.scratch / side, args.python)
    shutil.rmtree(args.scratch, ignore_errors=True)
    args.out.write_text(json.dumps(runs) + "\n")
    print(json.dumps({side: len(r) for side, r in runs.items()}))
    return 0


def _excerpts(found: list[dict], runs: dict) -> int:
    """Attach base/head excerpts of each differing field; returns the count of distinct differences."""
    distinct = set()
    for item in found:
        for side in ("base", "head"):
            outcome = normalise(runs[side][item["case"]])
            item[side] = {f: (outcome[f] if f == "rc" else str(outcome[f])[:EXCERPT]) for f in item["fields"]}
        if item["status"] == "differs":
            distinct.add(json.dumps([item["base"], item["head"]], sort_keys=True))
    return len(distinct)


def _verdict(args) -> int:
    cases, runs = load_cases(args.cases), json.loads(args.runs.read_text())
    regrade = json.loads(args.regrade.read_text()) if args.regrade else None
    waivers = json.loads(args.waivers.read_text()) if args.waivers else []
    result = verdict(cases, runs, regrade, waivers, args.spec_dir)
    result["distinct_differences"] = _excerpts(result["differences"], runs)
    args.out.write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps({k: result[k] for k in ("pass", "pass_tests_tier", "distinct_differences", "tiers")}))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="diffgate", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    rp = sub.add_parser("replay")
    for flag in ("--cases", "--base", "--head", "--scratch", "--out"):
        rp.add_argument(flag, type=Path, required=True)
    rp.add_argument("--python", required=True)
    rp.add_argument("--generate", action="store_true")
    vp = sub.add_parser("verdict")
    for flag in ("--cases", "--runs", "--out"):
        vp.add_argument(flag, type=Path, required=True)
    for flag in ("--regrade", "--waivers", "--spec-dir"):
        vp.add_argument(flag, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    return _replay(args) if args.command == "replay" else _verdict(args)


if __name__ == "__main__":
    sys.exit(main())
