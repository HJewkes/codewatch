"""The per-run JSON (decision 498): pins, cost and turns, and the hidden pass rates before and after.

`before` is the recorded cp N rate of the starting tree, `after` is the cp N+1 rate of this
solve, and `recorded_next` is the seed's own recorded cp N+1 rate, the parity target.
"""

from __future__ import annotations

import json
from pathlib import Path

SCHEMA = "codewatch.solvenext.run/1"
SCB_CHECK_VERSION = "0.1.3"
SLOP_CODE_COMMIT = "31ceea3"
PIN_KEYS = ("harness_commit", "harness_dirty", "scb_check_version", "slop_code_commit", "model_id",
            "image", "prompt_template", "prompt_sha256", "step_limit", "seed_set")
COST_KEYS = ("usd", "turns", "duration_ms", "wall_s", "exit", "subtype", "is_error")
RATE_KEYS = ("before", "after", "recorded_next")


def rate(passed: int, total: int) -> dict:
    return {"passed": passed, "total": total, "rate": passed / total if total else None}


def recorded_rate(evaluation: Path) -> dict | None:
    """A seed's evaluation.json, as the runner graded it: every test it collected for that checkpoint."""
    if not evaluation.is_file():
        return None
    data = json.loads(evaluation.read_text())
    return rate(sum(data["pass_counts"].values()), sum(data["total_counts"].values()))


def eval_rate(summary: Path) -> dict | None:
    if not summary.is_file():
        return None
    data = json.loads(summary.read_text())
    return rate(data["passed"], data["total"])


def solve_cost(stdout_jsonl: Path, exit_code: int, wall_s: int) -> dict:
    result = {}
    if stdout_jsonl.is_file():
        for line in stdout_jsonl.read_text().splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict) and event.get("type") == "result":
                result = event
    return {"usd": result.get("total_cost_usd"), "turns": result.get("num_turns"),
            "duration_ms": result.get("duration_ms"), "wall_s": wall_s, "exit": exit_code,
            "subtype": result.get("subtype"), "is_error": result.get("is_error")}


def build_run(*, task: str, arm: str, replicate: int, problem: str, n: int, include_prior_tests: bool,
              pins: dict, cost: dict, rates: dict, created_at: str) -> dict:
    run = {"schema": SCHEMA, "task": task, "arm": arm, "replicate": replicate, "problem": problem,
           "checkpoint_from": n, "checkpoint_to": n + 1, "include_prior_tests": include_prior_tests,
           "pins": {k: pins.get(k) for k in PIN_KEYS}, "cost": {k: cost.get(k) for k in COST_KEYS},
           "pass_rates": {k: rates.get(k) for k in RATE_KEYS}, "created_at": created_at}
    errors = validate_run(run)
    if errors:
        raise ValueError("; ".join(errors))
    return run


def _rate_errors(name: str, value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, dict) or not {"passed", "total", "rate"} <= value.keys():
        return [f"pass_rates.{name} needs passed, total and rate"]
    if value["total"] and not 0 <= value["rate"] <= 1:
        return [f"pass_rates.{name}.rate is outside [0, 1]"]
    return []


def validate_run(run: dict) -> list[str]:
    """Schema errors; an empty list means the run is valid. Pins are required, rates may be null."""
    if run.get("schema") != SCHEMA:
        return [f"schema is not {SCHEMA}"]
    errors = [f"missing {k}" for k in ("task", "arm", "problem", "checkpoint_from", "checkpoint_to") if run.get(k) is None]
    if run.get("checkpoint_to") != (run.get("checkpoint_from") or 0) + 1:
        errors.append("checkpoint_to must be checkpoint_from + 1")
    pins = run.get("pins") or {}
    errors += [f"missing pin {k}" for k in PIN_KEYS if pins.get(k) is None]
    errors += [f"missing cost.{k}" for k in COST_KEYS if k not in (run.get("cost") or {})]
    rates = run.get("pass_rates") or {}
    for name in RATE_KEYS:
        errors += _rate_errors(name, rates.get(name)) if name in rates else [f"missing pass_rates.{name}"]
    return errors
