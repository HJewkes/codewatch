"""Renders an Analysis as the section 6 table (report.md) and as report.json.

Neither output carries per-rule scb-check counts: the readers never load them (section 3).
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .analyse import Analysis
from .paired import ARMS, CheckpointRow

SOLVE = ("strict", "iso", "core")


def write_reports(analysis: Analysis, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.md").write_text(render_markdown(analysis))
    (out_dir / "report.json").write_text(json.dumps(to_json(analysis), indent=2) + "\n")


def to_json(analysis: Analysis) -> dict:
    return {
        "tests_dirs": list(analysis.tests_dirs),
        "decision": asdict(analysis.decision),
        "summaries": {name: asdict(s) for name, s in analysis.summaries.items()},
        "consistency": {
            "erosion": asdict(analysis.erosion_consistency),
            "verbosity": asdict(analysis.verbosity_consistency),
        },
        "gaming": {**asdict(analysis.gaming), "clean": analysis.gaming.clean},
        "fire_rate": analysis.fire_rate,
        "mechanism": analysis.mechanism,
        "checkpoints": [_row_json(row) for row in analysis.rows],
        "finals": [_row_json(row) for row in analysis.finals],
    }


def _row_json(row: CheckpointRow) -> dict:
    return {
        "problem": row.problem,
        "checkpoint": row.index,
        "arms": {
            arm: {m: row.solved(arm, m) for m in SOLVE}
            | {m: row.value(arm, m) for m in ("erosion", "verbosity", "usd")}
            for arm in ARMS
            if row.cells[arm] is not None
        },
        "a1_minus_a1a": {
            m: row.delta("A1", "A1a", m) for m in (*SOLVE, "erosion", "verbosity", "usd")
        },
    }


def render_markdown(analysis: Analysis) -> str:
    sections = [
        "# SCBench pilot analysis",
        _decision_section(analysis),
        _summary_section(analysis),
        _gaming_section(analysis),
        _mechanism_section(analysis),
        _finals_section(analysis),
        _paired_section(analysis),
    ]
    return "\n\n".join(sections) + "\n"


def _decision_section(a: Analysis) -> str:
    d = a.decision
    lines = [
        f"## Verdict: {d.verdict}",
        "",
        f"- T = {d.threshold:.0%}; ΔS = {d.delta_strict:+d}; ΔISO = {d.delta_iso:+d}",
        f"- ΔE = {_pct(d.delta_erosion)} ({_consistency(a.erosion_consistency)})",
        f"- ΔV = {_pct(d.delta_verbosity)} ({_consistency(a.verbosity_consistency)})",
        f"- A1 $/checkpoint over A0: {_num(d.cost_ratio, '.2f', 'x')}",
        f"- Stage fire rate: {a.fire_rate:.0%}",
        "",
        "Matched conditions:",
        *(f"- {reason}" for reason in d.reasons),
    ]
    return "\n".join(lines)


def _consistency(c) -> str:
    return f"A1 lower at {c.lower} of {c.problems} final checkpoints, needs {c.needed}"


def _summary_section(a: Analysis) -> str:
    header = (
        "| Arm | Strict | ISO | Core | Erosion | Verbosity | Erosion, tests excl. "
        "| Verbosity, tests excl. | $/ckpt | Parity gap |"
    )
    rows = [
        f"| {name} | {s.strict}/{s.expected} | {s.iso}/{s.expected} | {s.core}/{s.expected} "
        f"| {_num(s.erosion)} | {_num(s.verbosity)} | {_num(s.erosion_ex_tests)} "
        f"| {_num(s.verbosity_ex_tests)} | {_num(s.usd_per_checkpoint, '.2f')} "
        f"| {_num(s.parity_gap)} |"
        for name, s in a.summaries.items()
    ]
    note = (
        f"Tests-excluded columns recompute the official metrics without "
        f"{', '.join(a.tests_dirs)}. A parity gap above about 0.01 means the eval format "
        "assumptions in inputs.py are off."
    )
    return "\n".join(["## Arms", "", header, "|---" * 10 + "|", *rows, "", note])


def _gaming_section(a: Analysis) -> str:
    g = a.gaming
    splits = (
        f"- Kept remediation split symbols (single-caller helper, pass-through): "
        f"{g.split_symbols} across {g.split_checkpoints} checkpoints"
    )
    drop = (
        f"- Summed paired erosion drop, A1a to A1: {g.erosion_drop:.3f}; at split checkpoints: "
        f"{g.split_drop:.3f}; share {_pct(g.split_share)} (limit 50%)"
    )
    return "\n".join([
        f"## Gaming checks: {'clean' if g.clean else 'NOT clean'}",
        "",
        splits,
        drop,
        f"- Tests-excluded run points the same way: {_yes_no(g.sensitivity_agrees)}",
    ])


def _mechanism_section(a: Analysis) -> str:
    lines = [f"- {key.replace('_', ' ')}: {_num(value, '.2f')}" for key, value in a.mechanism.items()]
    return "\n".join(["## Mechanism signals (A1)", "", *lines])


def _finals_section(a: Analysis) -> str:
    return "\n".join(["## Per-problem final checkpoints", "", *_table(a.finals)])


def _paired_section(a: Analysis) -> str:
    return "\n".join(["## Paired per-checkpoint deltas", "", *_table(a.rows)])


def _table(rows: list[CheckpointRow]) -> list[str]:
    header = (
        "| Problem | Ckpt | Strict A0/A1a/A1 | ISO A0/A1a/A1 | Core A0/A1a/A1 "
        "| Erosion A1a → A1 | ΔE | Verbosity A1a → A1 | ΔV | $ A1a → A1 |"
    )
    return [header, "|---" * 10 + "|", *(_table_row(row) for row in rows)]


def _table_row(row: CheckpointRow) -> str:
    solved = [
        "/".join(_solve_mark(row, arm, m) for arm in ARMS) for m in SOLVE
    ]
    pairs = [
        f"{_num(row.value('A1a', m))} → {_num(row.value('A1', m))} "
        f"| {_num(row.delta('A1', 'A1a', m), '+.3f')}"
        for m in ("erosion", "verbosity")
    ]
    usd = f"{_num(row.value('A1a', 'usd'), '.2f')} → {_num(row.value('A1', 'usd'), '.2f')}"
    return f"| {row.problem} | {row.index} | {' | '.join(solved)} | {' | '.join(pairs)} | {usd} |"


def _solve_mark(row: CheckpointRow, arm: str, measure: str) -> str:
    if row.cells[arm] is None:
        return "–"
    return "✓" if row.solved(arm, measure) else "✗"


def _num(value, spec: str = ".3f", suffix: str = "") -> str:
    if value is None:
        return "n/a"
    if isinstance(value, int) and not spec.startswith("+"):
        return str(value)
    return f"{value:{spec}}{suffix}"


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.1%}"


def _yes_no(value: bool | None) -> str:
    return {True: "yes", False: "no", None: "unknown (tests-excluded data missing)"}[value]
