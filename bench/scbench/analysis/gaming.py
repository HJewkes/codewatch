"""Gaming checks, stage fire rate and mechanism signals, all read from A1's stages.json."""

from __future__ import annotations

from dataclasses import dataclass

from .inputs import CheckpointResult, Stage
from .metrics import ArmSummary
from .paired import CheckpointRow
from .signals import fix_items, mechanism_counts, split_commits

MAX_SPLIT_SHARE = 0.5


@dataclass(frozen=True)
class GamingCheck:
    split_checkpoints: int
    split_symbols: int
    erosion_drop: float
    split_drop: float
    split_share: float | None
    sensitivity_agrees: bool | None
    split_commits: int = 0

    @property
    def splits_clean(self) -> bool:
        return self.split_share is None or self.split_share <= MAX_SPLIT_SHARE

    @property
    def clean(self) -> bool:
        return self.splits_clean and self.sensitivity_agrees is True


def _kept_split_counts(result: CheckpointResult | None) -> list[int]:
    if result is None or result.stage_log is None:
        return []
    return split_commits(fix_items(result.stage_log.stages))


def split_symbols(result: CheckpointResult | None) -> int:
    """Symbols that kept phase-2 or phase-3 commits added and codewatch flags as a split.

    Read per commit, so a reverted commit or a phase-1 test gap never counts, whatever the stage status.
    """
    return sum(_kept_split_counts(result))


def gaming_check(rows: list[CheckpointRow], a1a: ArmSummary, a1: ArmSummary) -> GamingCheck:
    """Attribute the whole paired erosion drop of a checkpoint to splits when any were kept.

    That over-attributes on purpose: a clean result is then trustworthy.
    """
    drops = [(row, row.delta("A1a", "A1", "erosion")) for row in rows]
    paired = [(row, d) for row, d in drops if d is not None]
    split = [(row, d) for row, d in paired if split_symbols(row.cells["A1"])]
    erosion_drop = sum(d for _, d in paired)
    split_drop = sum(d for _, d in split)
    return GamingCheck(
        split_checkpoints=len(split),
        split_symbols=sum(split_symbols(row.cells["A1"]) for row in rows),
        split_commits=sum(n > 0 for row in rows for n in _kept_split_counts(row.cells["A1"])),
        erosion_drop=erosion_drop,
        split_drop=split_drop,
        split_share=split_drop / erosion_drop if erosion_drop > 0 else None,
        sensitivity_agrees=_sensitivity_agrees(a1a, a1),
    )


def _sensitivity_agrees(a1a: ArmSummary, a1: ArmSummary) -> bool | None:
    """Compares directions as raw differences, so two zero scores read as no change."""
    pairs = [
        (_difference(a1.erosion, a1a.erosion), _difference(a1.erosion_ex_tests, a1a.erosion_ex_tests)),
        (_difference(a1.verbosity, a1a.verbosity),
         _difference(a1.verbosity_ex_tests, a1a.verbosity_ex_tests)),
    ]
    if any(official is None or excluded is None for official, excluded in pairs):
        return None
    return all(_sign(official) == _sign(excluded) for official, excluded in pairs)


def _difference(new: float | None, base: float | None) -> float | None:
    return None if new is None or base is None else new - base


def _sign(value: float) -> int:
    return (value > 0) - (value < 0)


def fired(result: CheckpointResult | None) -> bool:
    """A checkpoint's stages fired when at least one stage ran and succeeded.

    Disabled, missing and budget-skipped stages never ran (exit null), so they do not count.
    """
    if result is None or result.stage_log is None:
        return False
    return any(stage.succeeded for stage in result.stage_log.stages)


def fire_rate(rows: list[CheckpointRow]) -> float:
    """Intent to treat: every expected checkpoint is in the denominator."""
    return sum(fired(row.cells["A1"]) for row in rows) / len(rows) if rows else 0.0


def mechanism_signals(rows: list[CheckpointRow]) -> dict[str, float | int | dict | None]:
    a1 = [row.cells["A1"] for row in rows if row.cells["A1"] and row.cells["A1"].stage_log]
    every_stage = [stage for result in a1 for stage in result.stage_log.stages]
    stages = [stage for stage in every_stage if stage.succeeded]
    triage_in = _total(stages, "triage", "items_in")
    net_fixed = [row for row in rows if _net_fix_kept(row.cells["A1"])]
    return {
        "findings_per_checkpoint": _total(stages, "audit", "items_out") / len(a1) if a1 else None,
        "confirmed_share": _total(stages, "triage", "items_out") / triage_in if triage_in else None,
        **mechanism_counts(every_stage),
        "mcp_tool_calls": sum(result.stage_log.mcp_tool_calls for result in a1),
        "stage_usd": sum(s.usd for s in every_stage),
        "stages_failed_or_timed_out": sum(s.status in ("failed", "timeout") for s in every_stage),
        "stages_skipped_budget": sum(s.status == "skipped_budget" for s in every_stage),
        "net_fix_checkpoints": len(net_fixed),
        "net_fix_strict_gains": sum(
            row.solved("A1", "strict") and not row.solved("A1a", "strict") for row in net_fixed
        ),
    }


def _total(stages: list[Stage], name: str, field: str) -> int:
    return sum(getattr(s, field) for s in stages if s.name == name)


def _net_fix_kept(result: CheckpointResult | None) -> bool:
    if result is None or result.stage_log is None:
        return False
    return any(item.status == "kept" for item in fix_items(result.stage_log.stages))
