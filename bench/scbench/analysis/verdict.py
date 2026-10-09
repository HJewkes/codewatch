"""The design section 6 decision rule: adopt, iterate or drop, comparing A1 with A1a."""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from .gaming import GamingCheck
from .metrics import ArmSummary, relative_change
from .paired import Consistency

BASE_THRESHOLD = 0.15
DROP_QUALITY_BAND = 0.10
MIN_FIRE_RATE = 0.75
MAX_COST_RATIO = 2.5


@dataclass(frozen=True)
class DecisionInputs:
    a0: ArmSummary
    a1a: ArmSummary
    a1: ArmSummary
    erosion_consistency: Consistency
    verbosity_consistency: Consistency
    gaming: GamingCheck
    fire_rate: float
    a0_replicate: ArmSummary | None = None


@dataclass(frozen=True)
class Decision:
    verdict: str
    threshold: float
    delta_strict: int
    delta_iso: int
    delta_erosion: float | None
    delta_verbosity: float | None
    cost_ratio: float | None
    reasons: list[str] = field(default_factory=list)


def quality_threshold(a0: ArmSummary, replicate: ArmSummary | None) -> float:
    """T = max(15%, twice the A0 versus A0' spread); 15% without a replicate."""
    if replicate is None:
        return BASE_THRESHOLD
    spreads = [
        abs(change)
        for change in (
            relative_change(replicate.erosion, a0.erosion),
            relative_change(replicate.verbosity, a0.verbosity),
        )
        if change is not None
    ]
    return max([BASE_THRESHOLD] + [2 * s for s in spreads])


def decide(inputs: DecisionInputs) -> Decision:
    threshold = quality_threshold(inputs.a0, inputs.a0_replicate)
    d_e = relative_change(inputs.a1.erosion, inputs.a1a.erosion)
    d_v = relative_change(inputs.a1.verbosity, inputs.a1a.verbosity)
    a0_cost, a1_cost = inputs.a0.usd_per_checkpoint, inputs.a1.usd_per_checkpoint
    decision = Decision(
        verdict="",
        threshold=threshold,
        delta_strict=inputs.a1.strict - inputs.a1a.strict,
        delta_iso=inputs.a1.iso - inputs.a1a.iso,
        delta_erosion=d_e,
        delta_verbosity=d_v,
        cost_ratio=a1_cost / a0_cost if a1_cost is not None and a0_cost else None,
    )
    verdict, reasons = _apply_rule(inputs, decision)
    return replace(decision, verdict=verdict, reasons=reasons)


def _met(delta: float | None, threshold: float, consistency: Consistency) -> bool:
    return delta is not None and delta <= -threshold and consistency.consistently_lower


def _apply_rule(inputs: DecisionInputs, d: Decision) -> tuple[str, list[str]]:
    """Adopt first; a fire rate under 75% blocks drop (section 7), so it is checked next."""
    e_met = _met(d.delta_erosion, d.threshold, inputs.erosion_consistency)
    v_met = _met(d.delta_verbosity, d.threshold, inputs.verbosity_consistency)
    adopt = _adopt_reasons(inputs, d, e_met and v_met)
    if adopt:
        return ("strong adopt" if d.delta_strict >= 2 else "adopt"), adopt
    if inputs.fire_rate < MIN_FIRE_RATE:
        return "iterate", [f"stages fired on {inputs.fire_rate:.0%} of checkpoints (< 75%)"]
    drop = _drop_reasons(inputs, d, e_met or v_met)
    if drop:
        return "drop", drop
    iterate = _iterate_reasons(inputs, d, e_met, v_met)
    if iterate:
        return "iterate", iterate
    return "undecided", ["no section 6 row matched; read the deltas before deciding"]


def _adopt_reasons(inputs: DecisionInputs, d: Decision, quality_met: bool) -> list[str]:
    checks = {
        "erosion and verbosity both met T, consistently": quality_met,
        f"ΔS = {d.delta_strict:+d} ≥ -1": d.delta_strict >= -1,
        f"ΔISO = {d.delta_iso:+d} ≥ -1": d.delta_iso >= -1,
        "gaming check clean": inputs.gaming.clean,
        "A1 $/checkpoint ≤ 2.5× A0": d.cost_ratio is not None and d.cost_ratio <= MAX_COST_RATIO,
    }
    return list(checks) if all(checks.values()) else []


def _drop_reasons(inputs: DecisionInputs, d: Decision, any_quality_met: bool) -> list[str]:
    flat = (
        d.delta_erosion is not None
        and d.delta_verbosity is not None
        and abs(d.delta_erosion) < DROP_QUALITY_BAND
        and abs(d.delta_verbosity) < DROP_QUALITY_BAND
        and abs(d.delta_strict) <= 1
    )
    if flat:
        return ["stages fired on ≥ 75%, |ΔE| < 10%, |ΔV| < 10% and |ΔS| ≤ 1"]
    if d.delta_strict <= -3 and not any_quality_met:
        return [f"ΔS = {d.delta_strict:+d} ≤ -3 with no quality gain"]
    return []


def _iterate_reasons(
    inputs: DecisionInputs, d: Decision, e_met: bool, v_met: bool
) -> list[str]:
    checks = {
        f"quality met but ΔS = {d.delta_strict:+d} ≤ -2": e_met and v_met and d.delta_strict <= -2,
        f"ΔS = {d.delta_strict:+d} ≥ +2 but quality not met": d.delta_strict >= 2
        and not (e_met and v_met),
        "only one of ΔE or ΔV met T": e_met != v_met,
        "gaming check failed": not inputs.gaming.clean,
    }
    return [reason for reason, hit in checks.items() if hit]
