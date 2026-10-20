"""Parity: does solving cp N+1 from the original seed cp N reproduce the recorded cp N+1 hidden rate?

C-210's rule sets the noise threshold T = max(15 points, 2 x spread), where spread is the range
(max - min) of the replicate pass rates. A problem holds parity when every replicate's
|rate - recorded| <= T. A single run has spread 0, so its T is the 15-point floor.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from solvenext.record import validate_run

FLOOR = 0.15
PARITY_ARM = "original"
# Rates are ratios of test counts, so a delta of exactly T can land a float ulp above it.
TOLERANCE = 1e-9


@dataclass(frozen=True)
class ParityRow:
    problem: str
    checkpoint_to: int
    recorded: float
    rates: tuple[float, ...]
    spread: float
    threshold: float
    max_delta: float
    holds: bool


def spread(rates: list[float]) -> float:
    return max(rates) - min(rates) if rates else 0.0


def threshold(rates: list[float]) -> float:
    return max(FLOOR, 2 * spread(rates))


def parity_row(problem: str, checkpoint_to: int, recorded: float, rates: list[float]) -> ParityRow:
    t = threshold(rates)
    max_delta = max(abs(r - recorded) for r in rates)
    return ParityRow(problem, checkpoint_to, recorded, tuple(rates), spread(rates), t, max_delta,
                     holds=max_delta <= t + TOLERANCE)


def load_runs(root: Path) -> list[dict]:
    runs = []
    for path in sorted(root.rglob("run.json")):
        run = json.loads(path.read_text())
        errors = validate_run(run)
        if errors:
            raise ValueError(f"{path}: {'; '.join(errors)}")
        runs.append(run)
    return runs


def parity_rows(runs: list[dict]) -> tuple[list[ParityRow], int]:
    """Rows for original-arm runs with a recorded target and an eval; also the count left out."""
    groups: dict[tuple[str, int], tuple[float, list[float]]] = {}
    skipped = 0
    for run in runs:
        rates = run["pass_rates"]
        recorded, after = rates.get("recorded_next"), rates.get("after")
        if run["arm"] != PARITY_ARM or not recorded or not after or after["rate"] is None or recorded["rate"] is None:
            skipped += 1
            continue
        key = (run["problem"], run["checkpoint_to"])
        groups.setdefault(key, (recorded["rate"], []))[1].append(after["rate"])
    rows = [parity_row(p, cp, rec, rs) for (p, cp), (rec, rs) in sorted(groups.items())]
    return rows, skipped


def _pct(value: float) -> str:
    return f"{100 * value:.1f}%"


def table(rows: list[ParityRow], skipped: int) -> str:
    lines = ["| Problem | cp | Recorded | Runs | Spread | T | Max delta | Parity |",
             "|---|---:|---:|---|---:|---:|---:|---|"]
    for row in rows:
        runs = ", ".join(_pct(r) for r in row.rates)
        lines.append(f"| {row.problem} | {row.checkpoint_to} | {_pct(row.recorded)} | {runs} | {_pct(row.spread)} "
                     f"| {_pct(row.threshold)} | {_pct(row.max_delta)} | {'holds' if row.holds else 'FAILS'} |")
    held = sum(row.holds for row in rows)
    lines += ["", (f"Parity holds on {held} of {len(rows)} problem(s); {skipped} run(s) left out "
                   "(not the original arm, or no recorded target or eval).")]
    return "\n".join(lines) + "\n"


def write_parity(rows: list[ParityRow], skipped: int, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "parity.json").write_text(json.dumps(
        {"floor": FLOOR, "rule": "T = max(15%, 2 x spread)", "skipped": skipped,
         "rows": [asdict(row) for row in rows]}, indent=1) + "\n")
    (out / "parity.md").write_text(table(rows, skipped))
