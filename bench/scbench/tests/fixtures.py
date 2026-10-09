"""Synthetic eval outputs in the shape inputs.py assumes. Nothing here comes from SCBench."""

from __future__ import annotations

import io
import json
import math
import tarfile
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


EXIT_BY_STATUS = {"ok": 0, "failed": 2}
RAN = ("ok", "failed", "timeout")


def stage(name: str, status: str = "ok", usd: float = 0.0, **extra) -> dict:
    """A row shaped like the agent's StageRecord.to_json() (bench/scbench/agent/stages.py)."""
    ran = status in RAN
    return {
        "stage": name, "status": status,
        "start": "2026-01-01T00:00:00+00:00" if ran else None,
        "end": "2026-01-01T00:01:00+00:00" if ran else None,
        "exit": EXIT_BY_STATUS.get(status), "tokens": 0, "usd": usd,
        "items_in": 0, "items_out": 0, **extra,
    }


def stages_json(*rows: dict, checkpoint: int = 1, mcp_tool_calls: int = 0) -> dict:
    return {"checkpoint": checkpoint, "stages": list(rows), "mcp_tool_calls": mcp_tool_calls}


def write_checkpoint(
    root: Path, problem: str, index: int, raw: dict, stages: dict | None = None, compress=False
) -> Path:
    directory = root / problem / f"checkpoint_{index}"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "evaluation.json").write_text(json.dumps(raw))
    if stages is not None and compress:
        _write_tarball(directory / "agent.tar.gz", json.dumps(stages).encode())
    elif stages is not None:
        (directory / "agent").mkdir()
        (directory / "agent" / "stages.json").write_text(json.dumps(stages))
    return directory


def _write_tarball(path: Path, payload: bytes) -> None:
    """Mirrors the runner: artifacts sit at the archive root, arcname = file name."""
    with tarfile.open(path, "w:gz") as archive:
        info = tarfile.TarInfo("stages.json")
        info.size = len(payload)
        archive.addfile(info, io.BytesIO(payload))
