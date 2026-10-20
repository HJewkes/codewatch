"""Parity: does solving cp N+1 from the original seed cp N reproduce the recorded cp N+1 hidden rate?

C-210's rule sets the noise threshold T = max(15 points, 2 x spread), where spread is the range
(max - min) of the replicate pass rates. A problem holds parity when every replicate's
|rate - recorded| <= T. A single run has spread 0, so its T is the 15-point floor.

A replicate counts only if its solve ran to a result and changed the tree. Errored solves and
no-op solves are left out and counted, and a problem whose recorded cp N+1 tree equals its cp N
tree is refused, because matching a no-op reference proves nothing.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from solvenext import plan, trees
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


@dataclass
class LeftOut:
    """Runs and problems kept out of the replicate set, by reason."""

    other_arm_or_unscored: int = 0
    errored: int = 0
    unchanged_tree: int = 0
    noop_reference_problems: int = 0
    noop_reference_runs: int = 0

    @property
    def total(self) -> int:
        return (self.other_arm_or_unscored + self.errored + self.unchanged_tree + self.noop_reference_runs)


def _derive_tree_flags(run: dict, run_dir: Path, seeds: Path | None) -> None:
    """Schema /1 runs predate the flags: derive them from the run's ws and the seed set when both are on disk."""
    seed_cp = (seeds / run["pins"]["seed_set"] / run["problem"] / f"checkpoint_{run['checkpoint_from']}") if seeds else None
    if run.get("tree_changed") is None and seed_cp and (run_dir / "ws").is_dir() and plan.solve_source(seed_cp).is_dir():
        run["tree_changed"] = trees.trees_differ(run_dir / "ws", plan.solve_source(seed_cp))
    nxt = seed_cp.parent / f"checkpoint_{run['checkpoint_to']}" if seed_cp else None
    if run.get("reference_noop") is None and nxt and plan.solve_source(nxt).is_dir() and plan.solve_source(seed_cp).is_dir():
        run["reference_noop"] = not trees.trees_differ(plan.solve_source(seed_cp), plan.solve_source(nxt))


def load_runs(root: Path, seeds: Path | None = None) -> list[dict]:
    runs = []
    for path in sorted(root.rglob("run.json")):
        run = json.loads(path.read_text())
        errors = validate_run(run)
        if errors:
            raise ValueError(f"{path}: {'; '.join(errors)}")
        _derive_tree_flags(run, path.parent, seeds)
        runs.append(run)
    return runs


def _unscored(run: dict) -> bool:
    recorded, after = run["pass_rates"].get("recorded_next"), run["pass_rates"].get("after")
    return run["arm"] != PARITY_ARM or not recorded or not after or after["rate"] is None or recorded["rate"] is None


def parity_rows(runs: list[dict]) -> tuple[list[ParityRow], LeftOut]:
    """Rows for original-arm runs that solved something and have a real recorded target; also what was left out."""
    groups: dict[tuple[str, int], tuple[float, list[float]]] = {}
    left = LeftOut()
    noop_problems: set[tuple[str, int]] = set()
    for run in runs:
        key = (run["problem"], run["checkpoint_to"])
        if _unscored(run):
            left.other_arm_or_unscored += 1
        elif run.get("reference_noop"):
            noop_problems.add(key)
            left.noop_reference_runs += 1
        elif run["cost"].get("is_error"):
            left.errored += 1
        elif run.get("tree_changed") is False:
            left.unchanged_tree += 1
        else:
            groups.setdefault(key, (run["pass_rates"]["recorded_next"]["rate"], []))[1].append(run["pass_rates"]["after"]["rate"])
    left.noop_reference_problems = len(noop_problems)
    rows = [parity_row(p, cp, rec, rs) for (p, cp), (rec, rs) in sorted(groups.items())]
    return rows, left


def _pct(value: float) -> str:
    return f"{100 * value:.1f}%"


def table(rows: list[ParityRow], left: LeftOut) -> str:
    lines = ["| Problem | cp | Recorded | Runs | Spread | T | Max delta | Parity |",
             "|---|---:|---:|---|---:|---:|---:|---|"]
    for row in rows:
        runs = ", ".join(_pct(r) for r in row.rates)
        lines.append(f"| {row.problem} | {row.checkpoint_to} | {_pct(row.recorded)} | {runs} | {_pct(row.spread)} "
                     f"| {_pct(row.threshold)} | {_pct(row.max_delta)} | {'holds' if row.holds else 'FAILS'} |")
    held = sum(row.holds for row in rows)
    lines += ["", f"Parity holds on {held} of {len(rows)} problem(s); {left.total} run(s) left out.",
              f"Left out: {left.errored} errored, {left.unchanged_tree} with an unchanged tree, "
              f"{left.noop_reference_runs} run(s) on {left.noop_reference_problems} problem(s) whose recorded reference is a no-op "
              f"(refused), {left.other_arm_or_unscored} not the original arm or without a recorded target or eval."]
    return "\n".join(lines) + "\n"


def write_parity(rows: list[ParityRow], left: LeftOut, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "parity.json").write_text(json.dumps(
        {"floor": FLOOR, "rule": "T = max(15%, 2 x spread)", "left_out": asdict(left) | {"total": left.total},
         "rows": [asdict(row) for row in rows]}, indent=1) + "\n")
    (out / "parity.md").write_text(table(rows, left))
