"""C-280 slice A: the S1 outcome keys of the audit's units, offline and measure only.

    python3 -m c280.keys collect TREE OUT.jsonl [--plain]   # inside the A1 image, venv in TREE
    python3 -m c280.keys reach TREE OUT.json [--plugin] [NODE_ID ...]   # lines and arcs under coverage
    python3 -m c280.keys verdict UNITS.json KEPT.jsonl NONE.jsonl OUT.json

`collect` runs the tree's suite once with the plugin on and prints a JSON summary (return code,
wall seconds, nodes with keys). `--plain` runs the same command without the plugin, for the
gate-time overhead. `verdict` joins the units with the keys of the R-none run, and the keys of
the kept (per-case) run; a unit has a new key when it has one the kept suite lacks, and is
admitted by the greedy rule when it is the first unit, by first node id within its bench, to
claim a new key. A unit holds the node ids of its test (every case of a parametrized
function); its keys are their union. Reach is not judged here: the audit's units were rejected for lacking new reach.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from findings.diff_uncovered import agent_test_env
from remediation.admission import read_reach
from remediation.outcomes import read_keys

PYTEST = "/opt/codewatch-a1/bin/pytest"
COVERAGE = "/opt/codewatch-a1/bin/coverage"
PYTEST_ARGS = ("-q", "-p", "no:cacheprovider")
PLUGIN = ("-p", "remediation.outcomes")
SCBENCH = str(Path(__file__).resolve().parents[1])


def _env(tree: Path, scratch: Path, out: Path | None) -> dict[str, str]:
    env = agent_test_env(tree, scratch)
    env["PYTHONPATH"] += f":{SCBENCH}"
    if out:
        env["SCB_OUTCOMES_OUT"] = str(out)
    return env


def collect(tree: Path, out: Path, plain: bool) -> dict[str, object]:
    scratch = out.parent / f"{out.stem}.scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    args = [PYTEST, *PYTEST_ARGS, *([] if plain else PLUGIN), "tests"]
    start = time.monotonic()
    done = subprocess.run(args, cwd=tree, env=_env(tree, scratch, None if plain else out), capture_output=True,
                          text=True, check=False)
    seconds = round(time.monotonic() - start, 2)
    return {"returncode": done.returncode, "seconds": seconds, "plugin": not plain,
            "nodes": len(read_keys(out)), "tail": done.stdout.strip().splitlines()[-1:]}


def reach(tree: Path, out: Path, plugin: bool, selection: list[str]) -> int:
    scratch = out.parent / f"{out.stem}.scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for old in scratch.glob(".coverage*"):
        old.unlink()
    rc = scratch / "coveragerc"
    rc.write_text(f"[run]\nbranch = true\ndata_file = {scratch / '.coverage'}\nparallel = true\npatch = subprocess\n")
    env = _env(tree, scratch, scratch / "outcomes.jsonl" if plugin else None)
    run = [COVERAGE, "run", f"--rcfile={rc}", "-m", "pytest", *PYTEST_ARGS, *(PLUGIN if plugin else ()),
           *(selection or ["tests"])]
    report = scratch / "coverage.json"
    for step in (run, [COVERAGE, "combine", f"--rcfile={rc}"], [COVERAGE, "json", f"--rcfile={rc}", "-o", str(report)]):
        subprocess.run(step, cwd=tree, env=env, capture_output=True, check=False)
    found = read_reach(report, tree, "tests")
    out.write_text(json.dumps(sorted(found or ())) + "\n")
    return 0 if found is not None else 1


def verdict(units: list[dict], kept: dict[str, frozenset[str]], none: dict[str, frozenset[str]]) -> list[dict]:
    """Per unit: its keys, those new against the kept suite, and the greedy admit decision."""
    kept_keys = set().union(*kept.values()) if kept else set()
    claimed: dict[str, set[str]] = {}
    rows = []
    for unit in sorted(units, key=lambda u: (u["bench"], u["nodeids"][0])):
        runs = [none[n] for n in unit["nodeids"] if n in none]
        found = frozenset().union(*runs) if runs else None
        row = {**unit, "keys": sorted(found or ()), "status": "no-run" if found is None else "ok"}
        new = sorted((found or frozenset()) - kept_keys)
        taken = claimed.setdefault(unit["bench"], set())
        fresh = [k for k in new if k not in taken]
        taken.update(fresh)
        rows.append({**row, "new_keys": new, "admit_any_new_key": bool(new), "admit_greedy": bool(fresh),
                     "reason": "key" if fresh else ""})
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("collect")
    run.add_argument("tree", type=Path)
    run.add_argument("out", type=Path)
    run.add_argument("--plain", action="store_true")
    cov = sub.add_parser("reach")
    cov.add_argument("tree", type=Path)
    cov.add_argument("out", type=Path)
    cov.add_argument("--plugin", action="store_true")
    cov.add_argument("nodes", nargs="*")
    join = sub.add_parser("verdict")
    for name in ("units", "kept", "none", "out"):
        join.add_argument(name, type=Path)
    args = parser.parse_args(argv)
    if args.command == "collect":
        print(json.dumps(collect(args.tree, args.out, args.plain)))
        return 0
    if args.command == "reach":
        return reach(args.tree, args.out, args.plugin, args.nodes)
    rows = verdict(json.loads(args.units.read_text()), read_keys(args.kept), read_keys(args.none))
    args.out.write_text(json.dumps(rows, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
