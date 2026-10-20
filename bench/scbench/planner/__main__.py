"""python3 -m planner plan <tree> [--graph-db DB] [--cap N]   the task plan as JSON (sorted keys)
python3 -m planner cut <tree> <unit key> <start> <end>       the cut width of a line range in one unit

`plan` exits 1 when two tasks of one wave own the same unit.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from planner import graph, plan_tree
from planner.cutwidth import cut_width
from planner.tasks import TOKEN_CAP, ownership_conflicts


def dump(data: dict) -> str:
    return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="planner")
    sub = p.add_subparsers(dest="cmd", required=True)
    plan = sub.add_parser("plan")
    plan.add_argument("tree")
    plan.add_argument("--graph-db")
    plan.add_argument("--cap", type=int, default=TOKEN_CAP)
    cut = sub.add_parser("cut")
    cut.add_argument("tree")
    cut.add_argument("key")
    cut.add_argument("start", type=int)
    cut.add_argument("end", type=int)
    args = p.parse_args(argv)
    if args.cmd == "cut":
        units, _ = graph(Path(args.tree))
        sys.stdout.write(dump(cut_width(units[args.key].node, args.start, args.end)))
        return 0
    result = plan_tree(Path(args.tree), args.graph_db, args.cap)
    sys.stdout.write(dump(result))
    conflicts = ownership_conflicts(result)
    for line in conflicts:
        print(line, file=sys.stderr)
    return 1 if conflicts else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
