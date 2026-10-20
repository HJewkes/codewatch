"""python3 -m planner plan <tree> [--graph-db DB] [--cap N] [--label L]   the task plan as JSON (sorted keys),
                                                             with each task's edits and plan template
python3 -m planner template <tree> <task id> [--label L]     one task's plan template (C-248 B8.2)
python3 -m planner cut <tree> <unit key> <start> <end>       the cut width of a line range in one unit

`plan` exits 1 when two tasks of one wave own or edit the same unit, or a task edits a unit it does not own.
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
    plan.add_argument("--label", default="")
    template = sub.add_parser("template")
    template.add_argument("tree")
    template.add_argument("task")
    template.add_argument("--label", default="")
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
    if args.cmd == "template":
        tasks = {t["id"]: t for t in plan_tree(Path(args.tree), label=args.label)["tasks"]}
        sys.stdout.write(tasks[args.task]["template"])
        return 0
    result = plan_tree(Path(args.tree), args.graph_db, args.cap, label=args.label)
    sys.stdout.write(dump(result))
    conflicts = ownership_conflicts(result)
    for line in conflicts:
        print(line, file=sys.stderr)
    return 1 if conflicts else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
