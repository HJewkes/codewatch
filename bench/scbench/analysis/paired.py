"""Paired per-checkpoint deltas and per-problem final checkpoints (design section 6)."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .inputs import CheckpointResult
from .metrics import Arm, checkpoint_cost

ARMS = ("A0", "A1a", "A1")
CONSISTENT_SHARE = 4 / 6


@dataclass(frozen=True)
class CheckpointRow:
    problem: str
    index: int
    cells: dict[str, CheckpointResult | None]

    def solved(self, arm: str, measure: str) -> bool:
        result = self.cells[arm]
        return bool(result and getattr(result, measure))

    def value(self, arm: str, measure: str) -> float | None:
        result = self.cells[arm]
        if result is None:
            return None
        return checkpoint_cost(result) if measure == "usd" else getattr(result, measure)

    def delta(self, new: str, base: str, measure: str) -> float | None:
        if measure in ("strict", "iso", "core"):
            return int(self.solved(new, measure)) - int(self.solved(base, measure))
        a, b = self.value(new, measure), self.value(base, measure)
        return None if a is None or b is None else a - b


@dataclass(frozen=True)
class Consistency:
    lower: int
    higher: int
    compared: int
    problems: int
    needed: int

    @property
    def consistently_lower(self) -> bool:
        return self.lower >= self.needed


def checkpoint_keys(arms: dict[str, Arm]) -> list[tuple[str, int]]:
    """The union of checkpoints any arm ran: missing cells count as unsolved."""
    return sorted({key for arm in arms.values() for key in arm})


def paired_rows(arms: dict[str, Arm]) -> list[CheckpointRow]:
    return [
        CheckpointRow(problem, index, {name: arms[name].get((problem, index)) for name in ARMS})
        for problem, index in checkpoint_keys(arms)
    ]


def final_rows(rows: list[CheckpointRow]) -> list[CheckpointRow]:
    finals: dict[str, CheckpointRow] = {}
    for row in rows:
        if row.problem not in finals or row.index > finals[row.problem].index:
            finals[row.problem] = row
    return [finals[p] for p in sorted(finals)]


def consistency(finals: list[CheckpointRow], measure: str) -> Consistency:
    """Direction of A1 against A1a at each problem's final checkpoint."""
    deltas = [row.delta("A1", "A1a", measure) for row in finals]
    compared = [d for d in deltas if d is not None]
    return Consistency(
        lower=sum(d < 0 for d in compared),
        higher=sum(d > 0 for d in compared),
        compared=len(compared),
        problems=len(finals),
        needed=math.ceil(CONSISTENT_SHARE * len(finals) - 1e-9),
    )
