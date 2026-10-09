"""Synthetic run directories in slop-code-bench's eval layout (see analysis/inputs.py).

Only the field names follow the runner's format. Every value, path and line of code here
is invented; nothing comes from an SCBench problem, test, solution or real run.
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

GROUPS = ("Core", "Functionality", "Error", "Regression")
EXIT_BY_STATUS = {"ok": 0, "failed": 2}
RAN = ("ok", "failed", "timeout")
FLAG = "# FLAG"
RULE_ID = "synthetic-rule-id-should-never-appear"


def evaluation(index: int, failing: tuple[str, ...] = ()) -> dict:
    """evaluation.json counts; checkpoint 1 has no Regression group."""
    groups = GROUPS if index > 1 else GROUPS[:-1]
    return {
        "checkpoint_name": f"checkpoint_{index}",
        "pass_counts": {g: 5 if g in failing else 10 for g in groups},
        "total_counts": {g: 10 for g in groups},
        "pytest_collected": 10 * len(groups),
    }


def snapshot(complex_source: bool, flagged_test_lines: int = 0) -> dict[str, str]:
    """A tiny workspace. The fake scb-check below scores names and FLAG markers."""
    source = "complex_app.py" if complex_source else "app.py"
    tests = "\n".join([f"x = {i}  {FLAG}" for i in range(flagged_test_lines)] + ["y = 0"] * 4)
    return {f"src/{source}": "a = 1\nb = 2\nc = 3\nd = 4\n", "tests/test_app.py": tests + "\n"}


def fake_scb_check(path: Path) -> dict:
    """Erosion: share of .py files named complex_*. Verbosity: FLAG lines over all lines."""
    files = sorted(path.rglob("*.py"))
    lines = [line for f in files for line in f.read_text().splitlines()]
    return {
        "erosion": sum(f.name.startswith("complex_") for f in files) / len(files) if files else 0.0,
        "verbosity": sum(FLAG in line for line in lines) / len(lines) if lines else 0.0,
        "total_loc": len(lines),
        "rules": {RULE_ID: 3},
    }


def official_scores(files: dict[str, str]) -> dict:
    """What `slop-code eval` would have recorded for this snapshot under fake_scb_check."""
    py = [p for p in files if p.endswith(".py")]
    lines = [line for p in py for line in files[p].splitlines()]
    return {
        "erosion": sum(Path(p).name.startswith("complex_") for p in py) / len(py),
        "verbosity": sum(FLAG in line for line in lines) / len(lines),
    }


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
    root: Path,
    problem: str,
    index: int,
    evaluation_raw: dict,
    *,
    files: dict[str, str] | None = None,
    scores: dict | None = None,
    cost: float | None = 1.0,
    stages: dict | None = None,
    compress: bool = False,
) -> Path:
    """One checkpoint directory plus its checkpoint_results.jsonl row."""
    directory = root / problem / f"checkpoint_{index}"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "evaluation.json").write_text(json.dumps(evaluation_raw))
    if cost is not None:
        (directory / "inference_result.json").write_text(json.dumps({"usage": {"cost": cost}}))
    for relative, text in (files or {}).items():
        target = directory / "snapshot" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    _write_stages(directory, stages, compress)
    row = {"problem": problem, "checkpoint": directory.name, "idx": index}
    row.update(scores if scores is not None else (official_scores(files) if files else {}))
    with (root / "checkpoint_results.jsonl").open("a") as handle:
        handle.write(json.dumps(row) + "\n")
    return directory


def _write_stages(directory: Path, stages: dict | None, compress: bool) -> None:
    if stages is None:
        return
    payload = json.dumps(stages).encode()
    if not compress:
        (directory / "agent").mkdir()
        (directory / "agent" / "stages.json").write_bytes(payload)
        return
    # Mirrors the runner: artifacts sit at the archive root, arcname = file name.
    with tarfile.open(directory / "agent.tar.gz", "w:gz") as archive:
        info = tarfile.TarInfo("stages.json")
        info.size = len(payload)
        archive.addfile(info, io.BytesIO(payload))
