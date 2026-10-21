"""score.py <run dir> --case C --repeat R --wall-s S [--rung L] [--pin SHA]: one S7 run as ar-result/v2 (C-256).

Reads what run_s7.sh leaves in the run dir: gates.json (the C-241 gates, total CC, single-caller counts),
regrade.json (hidden tests before and after), result.json (the run's $) and cleanup/ledger.jsonl (the
runner's task rows). Prints one JSON line and writes it to <run dir>/ar-result.json.

  metrics     cc_total_delta_pct, single_caller_delta, accepted_tasks (0 marks a no-op run), src_net,
              helpers_one_site_delta, cog_max_delta
  gates       hidden, growth, helpers, tests: gates.json's four, so all true is its `pass`
  violations  hidden_regressions: hidden tests that passed before and fail after
The engine's schema strips unknown keys, so rung, evaluator_pin and artifact_dir ride along for the
record and the console only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCHEMA = "ar-result/v2"
GATES = ("hidden", "growth", "helpers", "tests")


def delta(pair: list) -> float:
    return (pair[1] or 0) - (pair[0] or 0)


def delta_pct(pair: list) -> float:
    return round(100.0 * delta(pair) / pair[0], 3) if pair[0] else 0.0


def hidden_regressions(regrade: dict) -> int:
    before, after = regrade["before"]["hidden"], regrade["after"]["hidden"]
    newly_failed = len(set(after["failed"]) - set(before["failed"]))
    return max(newly_failed, before["passed"] - after["passed"], 0)


def accepted_tasks(ledger: Path) -> int:
    rows = [json.loads(line) for line in ledger.read_text().splitlines() if line.strip()] if ledger.is_file() else []
    return sum(row.get("kind") == "task" and row.get("outcome") == "accept" for row in rows)


def metrics(gates: dict, run: Path) -> dict:
    return {"cc_total_delta_pct": delta_pct(gates["cc_total"]), "single_caller_delta": delta(gates["single_caller"]),
            "accepted_tasks": accepted_tasks(run / "cleanup" / "ledger.jsonl"), "src_net": gates["src_net"],
            "helpers_one_site_delta": delta(gates["helpers_one_site"]), "cog_max_delta": delta(gates["cog_max"])}


def score(run: Path, case: str, repeat: str, wall_s: float) -> dict:
    gates = json.loads((run / "gates.json").read_text())
    regrade = json.loads((run / "regrade.json").read_text())
    usd = json.loads((run / "result.json").read_text())["total_cost_usd"] or 0.0
    return {"schema": SCHEMA, "case": case, "repeat": repeat, "metrics": metrics(gates, run),
            "gates": {name: bool(gates["gates"][name]) for name in GATES},
            "violations": {"hidden_regressions": hidden_regressions(regrade)},
            "usd": round(float(usd), 6), "wall_s": round(max(wall_s, 0.0), 1)}


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="score.py")
    p.add_argument("run", type=Path)
    p.add_argument("--case", required=True)
    p.add_argument("--repeat", required=True)
    p.add_argument("--wall-s", type=float, required=True)
    p.add_argument("--rung", default="seed")
    p.add_argument("--pin", default="unknown")
    a = p.parse_args(argv)
    result = {**score(a.run, a.case, a.repeat, a.wall_s), "rung": a.rung, "evaluator_pin": a.pin,
              "artifact_dir": str(a.run.resolve())}
    line = json.dumps(result, sort_keys=True)
    (a.run / "ar-result.json").write_text(line + "\n")
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
