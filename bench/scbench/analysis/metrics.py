"""Per-arm measures from design section 6, and the tests-excluded sensitivity rerun."""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import mean

from .inputs import CheckpointResult, FileQuality

EROSION_CC_THRESHOLD = 10

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


def is_test_path(path: str, tests_dirs: tuple[str, ...]) -> bool:
    normalised = path.replace("\\", "/")
    while normalised.startswith("./"):
        normalised = normalised[2:]
    return any(normalised == d or normalised.startswith(d.rstrip("/") + "/") for d in tests_dirs)


def recompute_erosion(files: tuple[FileQuality, ...], exclude: tuple[str, ...]) -> float | None:
    masses = [
        (c.cc, c.cc * math.sqrt(c.sloc))
        for f in files
        if not is_test_path(f.path, exclude)
        for c in f.callables
    ]
    total = sum(m for _, m in masses)
    if total == 0:
        return None
    return sum(m for cc, m in masses if cc > EROSION_CC_THRESHOLD) / total


def recompute_verbosity(files: tuple[FileQuality, ...], exclude: tuple[str, ...]) -> float | None:
    kept = [f for f in files if not is_test_path(f.path, exclude)]
    loc = sum(f.loc for f in kept)
    if loc == 0:
        return None
    return min(1.0, sum(f.flagged_lines for f in kept) / loc)


def checkpoint_cost(result: CheckpointResult) -> float | None:
    stage_usd = sum(s.usd for s in result.stage_log.stages) if result.stage_log else 0.0
    if result.cost_usd is None and not result.stage_log:
        return None
    return (result.cost_usd or 0.0) + stage_usd


def summarise(arm: Arm, expected: int, tests_dirs: tuple[str, ...]) -> ArmSummary:
    results = list(arm.values())
    with_files = [r for r in results if r.files is not None]
    return ArmSummary(
        expected=expected,
        ran=len(results),
        strict=sum(r.strict for r in results),
        iso=sum(r.iso for r in results),
        core=sum(r.core for r in results),
        erosion=_mean(_official(r, "erosion") for r in results),
        verbosity=_mean(_official(r, "verbosity") for r in results),
        erosion_ex_tests=_mean(recompute_erosion(r.files, tests_dirs) for r in with_files),
        verbosity_ex_tests=_mean(recompute_verbosity(r.files, tests_dirs) for r in with_files),
        usd_per_checkpoint=_mean(checkpoint_cost(r) for r in results),
        parity_gap=_parity_gap(with_files),
    )


def _official(result: CheckpointResult, metric: str) -> float | None:
    value = getattr(result, metric)
    if value is not None or result.files is None:
        return value
    recompute = recompute_erosion if metric == "erosion" else recompute_verbosity
    return recompute(result.files, ())


def _parity_gap(results: list[CheckpointResult]) -> float | None:
    """Largest gap between an official value and its all-files recompute.

    A large gap means the format assumptions in inputs.py are wrong and the
    tests-excluded numbers cannot be trusted.
    """
    gaps = [
        abs(official - recomputed)
        for r in results
        for official, recomputed in (
            (r.erosion, recompute_erosion(r.files, ())),
            (r.verbosity, recompute_verbosity(r.files, ())),
        )
        if official is not None and recomputed is not None
    ]
    return max(gaps) if gaps else None


def _mean(values) -> float | None:
    present = [v for v in values if v is not None]
    return mean(present) if present else None


def relative_change(new: float | None, base: float | None) -> float | None:
    if new is None or base is None or base == 0:
        return None
    return (new - base) / base
