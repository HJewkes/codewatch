"""Per-arm measures from design section 6, and the tests-excluded sensitivity rerun."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

from .inputs import CheckpointResult

Arm = dict[tuple[str, int], CheckpointResult]


@dataclass(frozen=True)
class ArmSummary:
    expected: int
    ran: int
    strict: int
    iso: int
    core: int
    erosion: float | None
    verbosity: float | None
    erosion_ex_tests: float | None
    verbosity_ex_tests: float | None
    usd_per_checkpoint: float | None
    parity_gap: float | None


def checkpoint_cost(result: CheckpointResult) -> float | None:
    stage_usd = sum(s.usd for s in result.stage_log.stages) if result.stage_log else 0.0
    if result.cost_usd is None and not result.stage_log:
        return None
    return (result.cost_usd or 0.0) + stage_usd


def summarise(arm: Arm, expected: int) -> ArmSummary:
    results = list(arm.values())
    reruns = [r.rerun for r in results if r.rerun is not None]
    return ArmSummary(
        expected=expected,
        ran=len(results),
        strict=sum(r.strict for r in results),
        iso=sum(r.iso for r in results),
        core=sum(r.core for r in results),
        erosion=_mean(r.erosion for r in results),
        verbosity=_mean(r.verbosity for r in results),
        erosion_ex_tests=_mean(r.erosion_ex_tests for r in reruns),
        verbosity_ex_tests=_mean(r.verbosity_ex_tests for r in reruns),
        usd_per_checkpoint=_mean(checkpoint_cost(r) for r in results),
        parity_gap=_parity_gap(results),
    )


def _parity_gap(results: list[CheckpointResult]) -> float | None:
    """Largest gap between a recorded official score and the rerun on the full snapshot.

    A gap means the rerun does not reproduce the graded numbers (another scb-check
    version, or a snapshot that is not the graded one), so the tests-excluded
    numbers cannot be trusted.
    """
    gaps = [
        abs(official - rerun)
        for r in results
        if r.rerun is not None
        for official, rerun in ((r.erosion, r.rerun.erosion_full), (r.verbosity, r.rerun.verbosity_full))
        if official is not None and rerun is not None
    ]
    return max(gaps) if gaps else None


def _mean(values) -> float | None:
    present = [v for v in values if v is not None]
    return mean(present) if present else None


def relative_change(new: float | None, base: float | None) -> float | None:
    if new is None or base is None or base == 0:
        return None
    return (new - base) / base
