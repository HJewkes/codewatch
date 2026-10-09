"""Ties the readers, measures, gaming checks and decision rule into one result."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .gaming import GamingCheck, fire_rate, gaming_check, mechanism_signals
from .inputs import load_arm
from .metrics import ArmSummary, summarise
from .paired import ARMS, CheckpointRow, Consistency, consistency, final_rows, paired_rows
from .verdict import Decision, DecisionInputs, decide


@dataclass(frozen=True)
class Analysis:
    summaries: dict[str, ArmSummary]
    rows: list[CheckpointRow]
    finals: list[CheckpointRow]
    erosion_consistency: Consistency
    verbosity_consistency: Consistency
    gaming: GamingCheck
    fire_rate: float
    mechanism: dict[str, float | int | None]
    decision: Decision
    tests_dirs: tuple[str, ...]


def analyse(
    arm_dirs: dict[str, Path], tests_dirs: tuple[str, ...], replicate_dir: Path | None = None
) -> Analysis:
    arms = {name: load_arm(arm_dirs[name], require_stages=name == "A1") for name in ARMS}
    rows = paired_rows(arms)
    summaries = {name: summarise(arms[name], len(rows), tests_dirs) for name in ARMS}
    if replicate_dir is not None:
        summaries["A0'"] = summarise(load_arm(replicate_dir), len(rows), tests_dirs)
    finals = final_rows(rows)
    inputs = DecisionInputs(
        a0=summaries["A0"],
        a1a=summaries["A1a"],
        a1=summaries["A1"],
        erosion_consistency=consistency(finals, "erosion"),
        verbosity_consistency=consistency(finals, "verbosity"),
        gaming=gaming_check(rows, summaries["A1a"], summaries["A1"]),
        fire_rate=fire_rate(rows),
        a0_replicate=summaries.get("A0'"),
    )
    return Analysis(
        summaries=summaries,
        rows=rows,
        finals=finals,
        erosion_consistency=inputs.erosion_consistency,
        verbosity_consistency=inputs.verbosity_consistency,
        gaming=inputs.gaming,
        fire_rate=inputs.fire_rate,
        mechanism=mechanism_signals(rows),
        decision=decide(inputs),
        tests_dirs=tests_dirs,
    )
