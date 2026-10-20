"""The cleanup run (C-248 S6): plan, then per-cluster sessions in waves, then gates, then one retry.

Per wave: re-plan the current tree; rules.at_start skips a stale or repeated task (and a task with no
feasible edit gets no session); each other task gets a lane, a copy of the wave base and one session;
the final gate (S4) judges it, rules.reinlined adds the T2 re-inline check, and a reject gets one retry
with one deterministic message. Accepted lanes are spliced at function level and the integration gate
runs on the result; on a failure the lanes are reverted in reverse splice order, one at a time first,
until it passes. Every task then gets its ledger row in <run dir>/ledger.jsonl.

`Steps` is the side-effect boundary (sessions, tests, diffgate, the T3 reviewer); container.py has the
real ones and the tests pass fakes.
"""

from __future__ import annotations

import json
import shutil
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from gate.__main__ import find_task
from gate.gates import final_gate
from gate.measure import sources
from ledger import append, ledger_path, read
from ledger.columns import skip_row, task_row, task_type
from ledger.rules import at_start, reinlined
from planner import plan_tree
from planner.families import load_config

from runner import prompt
from runner.integrate import integrate
from runner.schedule import next_wave, runnable, shared_wave


@dataclass
class Run:
    id: str
    out: Path
    specs: list[str]
    only: set[str] | None = None
    max_usd: float = 7.0
    cfg: dict = field(default_factory=load_config)
    planner: Callable[[Path, dict, str], dict] | None = None
    spent: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def plan(self, root: Path) -> dict:
        return (self.planner or (lambda r, c, label: plan_tree(r, cfg=c, label=label)))(root, self.cfg, self.id)

    def charge(self, usd: float) -> None:
        with self.lock:
            self.spent = round(self.spent + usd, 6)

    def over_budget(self) -> bool:
        with self.lock:
            return self.spent >= self.max_usd


def slug(task_id: str) -> str:
    return task_id.replace("/", "_").replace(":", "__")


def _judge(run: Run, steps, task: dict, base: Path, ws: Path, out: Path) -> dict:
    visible = steps.visible(ws, out)
    dg = steps.diffgate(base, ws, out)
    result = final_gate(base, ws, task, run.cfg, visible, dg, steps.review)
    reinline = reinlined(read(ledger_path(run.out)), result["report"])
    outcome = "reject" if reinline else result["outcome"]
    verdict = {"outcome": outcome, "tier": result["tier"], "reasons": result["reasons"] + reinline,
               "visible": visible, "diffgate_pass": dg.get("pass")}
    (out / "final.json").write_text(json.dumps(verdict, indent=1, sort_keys=True) + "\n")
    return {"result": result, "reinline": reinline, "diffgate": dg, "outcome": outcome}


def _attempt(run: Run, steps, lane: dict, text: str, n: int) -> dict:
    out = lane["dir"] / f"a{n}"
    out.mkdir(parents=True, exist_ok=True)
    facts = steps.session(f"{run.id}-{slug(lane['task']['id'])}-a{n}"[:120], lane["ws"], text, lane["gate"],
                          lane["base"], out)
    run.charge(facts.get("usd", 0.0))
    return {"n": n, "facts": facts, **_judge(run, steps, lane["task"], lane["base"], lane["ws"], out)}


def run_task(run: Run, steps, task: dict, base: Path, wave_dir: Path, plan_file: Path) -> dict:
    task = find_task(base, task["id"], plan_file)
    lane = {"task": task, "base": base, "dir": wave_dir / slug(task["id"])}
    lane["ws"] = steps.workspace(base, lane["dir"] / "ws")
    lane["gate"] = lane["dir"] / "gate"
    lane["gate"].mkdir(parents=True, exist_ok=True)
    shutil.copy2(plan_file, lane["gate"] / "plan.json")
    text = prompt.build(task, run.specs, sources(base))
    attempts = [_attempt(run, steps, lane, text, 1)]
    if attempts[0]["outcome"] == "reject" and not run.over_budget():
        first = attempts[0]
        message = prompt.retry_message(first["result"], first["diffgate"], first["reinline"])
        (lane["dir"] / "retry_message.txt").write_text(message + "\n")
        attempts.append(_attempt(run, steps, lane, text + prompt.retry_section(message), 2))
    refused = (lane["gate"] / "refused").read_text().count("refused") if (lane["gate"] / "refused").is_file() else 0
    return {**lane, "attempts": attempts, "refused": refused}


def _start(run: Run, wave: dict, texts: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """(tasks that get a lane, skip rows) at wave start."""
    rows, lanes, skips = read(ledger_path(run.out)), [], []
    for task in wave["tasks"]:
        reason = at_start(rows, task, task_type(task), texts, run.cfg) or runnable(task)
        reason = reason or ("run dollar cap reached" if run.over_budget() else None)
        if reason:
            skips.append(append(ledger_path(run.out), skip_row({"id": run.id}, task, reason)))
        else:
            lanes.append(task)
    return lanes, skips


def _row(run: Run, lane: dict, revert: str | None) -> dict:
    last = lane["attempts"][-1]
    facts = {"usd": sum(a["facts"].get("usd", 0.0) for a in lane["attempts"]), "retry_used": len(lane["attempts"]) > 1,
             "calls_log": lane["gate"] / "calls.json", "refused": lane["refused"], "integration_revert": revert}
    row = task_row({"id": run.id}, lane["task"], last["result"], facts, sources(lane["ws"]), run.cfg, last["reinline"])
    return append(ledger_path(run.out), row)


def run_wave(run: Run, steps, k: int, wave: dict, base: Path, plan: dict) -> dict:
    wave_dir = run.out / f"wave{k}"
    wave_dir.mkdir(parents=True, exist_ok=True)
    plan_file = wave_dir / "plan.json"
    plan_file.write_text(json.dumps(plan, sort_keys=True) + "\n")
    tasks, skips = _start(run, wave, sources(base))
    with ThreadPoolExecutor(max_workers=max(1, wave["lanes"])) as pool:
        lanes = list(pool.map(lambda t: run_task(run, steps, t, base, wave_dir, plan_file), tasks))
    accepted = {lane["task"]["id"]: lane["ws"] for lane in lanes if lane["attempts"][-1]["outcome"] == "accept"}
    merged = integrate(steps, base, wave_dir, accepted)
    rows = [_row(run, lane, merged["reverted"].get(lane["task"]["id"])) for lane in lanes]
    return {"wave": k, "kind": wave["kind"], "plan_wave": wave["plan_wave"], "lanes": wave["lanes"],
            "tasks": [t["id"] for t in wave["tasks"]], "skips": [s["cluster"] for s in skips],
            "sessions": [_lane_summary(lane) for lane in lanes], "splice": merged["splice"],
            "integration": merged["checks"], "reverted": merged["reverted"], "tree": str(merged["tree"]),
            "rows": len(rows) + len(skips)}


def _lane_summary(lane: dict) -> dict:
    return {"task": lane["task"]["id"], "refused": lane["refused"], "attempts": [
        {"n": a["n"], "outcome": a["outcome"], "tier": a["result"]["tier"], "reasons": a["result"]["reasons"] + a["reinline"],
         "usd": a["facts"].get("usd", 0.0), "tree_changed": a["facts"].get("tree_changed"),
         "diffgate_pass": a["diffgate"].get("pass")} for a in lane["attempts"]]}


def execute(run: Run, steps, frozen: Path) -> dict:
    """Run every wave over a copy of the frozen tree; -> run.json's content."""
    base = steps.workspace(frozen, run.out / "base")
    plan = run.plan(base)
    waves = [run_wave(run, steps, 1, shared_wave(plan, run.only), base, plan)]
    done = set(waves[0]["tasks"])
    base = Path(waves[0]["tree"])
    while (wave := next_wave(plan := run.plan(base), done, run.only)) is not None:
        waves.append(run_wave(run, steps, len(waves) + 1, wave, base, plan))
        done |= set(waves[-1]["tasks"])
        base = Path(waves[-1]["tree"])
    summary = {"run": run.id, "usd": run.spent, "waves": waves, "final_tree": str(base)}
    (run.out / "run.json").write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n")
    return summary

