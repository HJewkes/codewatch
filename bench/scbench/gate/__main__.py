"""python3 -m gate --cluster <task id> --base <frozen tree> [--workspace DIR] [--plan plan.json] [--json]
                 [--calls FILE]
The implementer's self-check (C-248 B8.3, owner R3-5): families against their tolerances, the constraint
verdicts and T1 on own-body CC, in the format the retry message shares (family.render). Advisory: the
final gate re-measures from the session's diff, and the integration gate runs outside the session. No
model call, no score, no floor, no rank.

The task (owned units, head) comes from --plan, the planner's JSON, or else from planning the base
without edits. Each call is logged to --calls (default $CW_GATE_CALLS, else scbench-gate-calls.json in the
temp dir, outside the workspace); a task gets at most 3. Exit 0 on an advisory pass, 1 on a fail, 2 when
the budget is spent or the task is unknown.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from gate.family import check, render
from planner import plan_tree
from planner.families import load_config

MAX_CALLS = 3
PASS_LINE = "advisory PASS (final gate runs after the session)"


def calls_file(given: str | None) -> Path:
    return Path(given or os.environ.get("CW_GATE_CALLS") or Path(tempfile.gettempdir()) / "scbench-gate-calls.json")


def take_call(path: Path, task: str) -> int | None:
    """The call's number for this task, or None once MAX_CALLS are spent."""
    log = json.loads(path.read_text()) if path.is_file() else {}
    used = log.get(task, 0)
    if used >= MAX_CALLS:
        return None
    log[task] = used + 1
    path.write_text(json.dumps(log, sort_keys=True) + "\n")
    return used + 1


def find_task(base: Path, task_id: str, plan: Path | None) -> dict | None:
    data = json.loads(plan.read_text()) if plan else plan_tree(base, edits=False)
    task = next((t for t in data["tasks"] if t["id"] == task_id), None)
    if task and task.get("chosen"):
        edits = [c for c in task.get("candidates", []) if c["id"] in task["chosen"]["edits"]]
        task = {**task, "recipe": ", ".join(sorted({e["recipe"] for e in edits}))}
    return task


def result_line(report: dict) -> str:
    bad = report["families"]["failed"] + (["T1"] if not report["t1"]["pass"] else [])
    bad += sorted(report["constraints"]) + (["ownership"] if report["ownership"] else [])
    return PASS_LINE if not bad else f"advisory FAIL: {', '.join(bad)} (final gate runs after the session)"


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python3 -m gate")
    p.add_argument("--cluster", required=True, help="the task id from the plan template")
    p.add_argument("--base", type=Path, required=True)
    p.add_argument("--workspace", type=Path, default=Path("."))
    p.add_argument("--plan", type=Path)
    p.add_argument("--calls")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    task = find_task(a.base, a.cluster, a.plan)
    if task is None:
        print(f"gate: no task {a.cluster} in the plan", file=sys.stderr)
        return 2
    if (n := take_call(calls_file(a.calls), a.cluster)) is None:
        print(f"gate: self-check budget spent ({MAX_CALLS} of {MAX_CALLS} calls for {a.cluster})", file=sys.stderr)
        return 2
    cfg = load_config()
    report = check(a.base, a.workspace, task, cfg)
    line = result_line(report)
    if a.json:
        public = {k: report[k] for k in ("task", "families", "t1", "constraints", "ownership", "sloc", "new")}
        print(json.dumps({**public, "call": n, "result": line}, sort_keys=True))
    else:
        sys.stdout.write(render(report, cfg, line))
    return 0 if line == PASS_LINE else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
