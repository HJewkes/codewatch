"""Synthetic eval outputs in the shape inputs.py assumes. Nothing here comes from SCBench."""

from __future__ import annotations

import json
import math
from pathlib import Path

ALL_GROUPS = ("core", "functionality", "error", "regression")


def source_file(path: str, high_cc: int, loc: int = 100, flagged: int = 20) -> dict:
    """A file with one CC-`high_cc` callable (sloc 16) and one CC-2 callable (sloc 4)."""
    return {
        "path": path,
        "loc": loc,
        "flagged_lines": flagged,
        "callables": [{"name": "big", "cc": high_cc, "sloc": 16}, {"name": "small", "cc": 2, "sloc": 4}],
    }


def evaluation(index: int, failing: tuple[str, ...] = (), files=None, cost: float = 1.0) -> dict:
    groups = ALL_GROUPS if index > 1 else ALL_GROUPS[:-1]
    tests = {g: {"passed": 5 if g in failing else 10, "total": 10} for g in groups}
    raw = {"tests": tests, "cost_usd": cost}
    if files is not None:
        raw["quality"] = {
            "erosion": _erosion(files),
            "verbosity": min(1.0, sum(f["flagged_lines"] for f in files) / sum(f["loc"] for f in files)),
            "files": files,
        }
    return raw


def _erosion(files: list[dict]) -> float:
    masses = [(c["cc"], c["cc"] * math.sqrt(c["sloc"])) for f in files for c in f["callables"]]
    return sum(m for cc, m in masses if cc > 10) / sum(m for _, m in masses)


def stage(name: str, exit: int = 0, usd: float = 0.0, **extra) -> dict:
    return {"stage": name, "exit": exit, "usd": usd, **extra}


def write_checkpoint(root: Path, problem: str, index: int, raw: dict, stages: dict | None = None):
    directory = root / problem / f"checkpoint_{index}"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "evaluation.json").write_text(json.dumps(raw))
    if stages is not None:
        (directory / "stages.json").write_text(json.dumps(stages))
