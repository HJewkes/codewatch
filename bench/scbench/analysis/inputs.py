"""Readers for `slop-code eval` output and the A1 harness's per-checkpoint `stages.json`.

Every assumption about the on-disk format lives in this module, so it can be fixed in
one place once real eval output exists. No real output has been read yet; the shapes
below are inferred from the published metric definitions.

Layout, one directory per arm:

    <arm>/<problem>/checkpoint_<n>/evaluation.json  (assumed)
    <arm>/<problem>/checkpoint_<n>/agent/stages.json
    <arm>/<problem>/checkpoint_<n>/agent.tar.gz     (holds stages.json when the
                                                     runner compresses artifacts)

The stages.json locations follow the runner's `save_agent_artifacts` at slop-code-bench
commit 31ceea3. Checkpoints are keyed by the runner's `checkpoint_<n>` directory, never
by the agent's own `checkpoint` field, which restarts at 1 after `--resume`.

Assumed `evaluation.json`:

    {
      "tests": {"core": {"passed": 9, "total": 10}, "functionality": {...},
                "error": {...}, "regression": {...}},      # regression absent at cp1
      "cost_usd": 0.81,                                     # solve session only
      "quality": {
        "erosion": 0.42, "verbosity": 0.21,                 # official scb-check values
        "files": [{"path": "tests/test_cli.py", "loc": 120,
                   "flagged_lines": 14,                     # AST-grep union clone lines
                   "callables": [{"name": "f", "cc": 12, "sloc": 30}]}]
      }
    }

A missing `quality` block means scb-check failed; that checkpoint drops out of the
quality means but still counts in the solve denominators. Any per-rule breakdown in
the file is deliberately never read (design section 3).

`stages.json`, as the A1 stage-hook agent (`bench/scbench/agent/stages.py`) writes it:

    {"checkpoint": 2, "mcp_tool_calls": 3,
     "stages": [{"stage": "index", "status": "disabled", "start": null, "end": null,
                 "exit": null, "tokens": 0, "usd": 0.0, "items_in": 0, "items_out": 0},
                {"stage": "remediation", "status": "ok", "start": "...", "end": "...",
                 "exit": 0, "usd": 0.31, "tokens": 900000, "items_in": 5,
                 "items_out": 4, "outcome": "kept", "fixed_replay_diffs": 1,
                 "added_symbols": [{"path": "src/a.py", "name": "_h",
                                    "flags": ["single-caller-helper"]}]}]}

`status` is one of disabled, missing, skipped_budget (the command never ran, exit
null), ok, failed or timeout. A failed stage may also carry `error`.
"""

from __future__ import annotations

import json
import re
import tarfile
from dataclasses import dataclass
from pathlib import Path

AGENT_DIR = "agent"
AGENT_TARBALL = "agent.tar.gz"
STAGES_FILE = "stages.json"
NON_REGRESSION_GROUPS = ("core", "functionality", "error")
REGRESSION_GROUP = "regression"
CHECKPOINT_DIR = re.compile(r"^checkpoint_(\d+)$")


@dataclass(frozen=True)
class CallableMetric:
    cc: float
    sloc: int


@dataclass(frozen=True)
class FileQuality:
    path: str
    loc: int
    flagged_lines: int
    callables: tuple[CallableMetric, ...]


@dataclass(frozen=True)
class AddedSymbol:
    path: str
    name: str
    flags: tuple[str, ...]


@dataclass(frozen=True)
class Stage:
    name: str
    status: str | None
    exit: int | None
    usd: float
    items_in: int
    items_out: int
    outcome: str | None
    fixed_replay_diffs: int
    added_symbols: tuple[AddedSymbol, ...]

    @property
    def succeeded(self) -> bool:
        if self.status is not None:
            return self.status == "ok"
        return self.exit == 0


@dataclass(frozen=True)
class StageLog:
    stages: tuple[Stage, ...]
    mcp_tool_calls: int


@dataclass(frozen=True)
class CheckpointResult:
    problem: str
    index: int
    strict: bool
    iso: bool
    core: bool
    cost_usd: float | None
    erosion: float | None
    verbosity: float | None
    files: tuple[FileQuality, ...] | None
    stage_log: StageLog | None


class StagesNotFoundError(FileNotFoundError):
    pass


def load_arm(arm_dir: Path, require_stages: bool = False) -> dict[tuple[str, int], CheckpointResult]:
    """Load one arm. `require_stages` is set for A1, whose agent always writes stages.json."""
    results = {}
    for problem_dir in sorted(p for p in arm_dir.iterdir() if p.is_dir()):
        for checkpoint_dir in sorted(problem_dir.iterdir()):
            match = CHECKPOINT_DIR.match(checkpoint_dir.name)
            if match and (checkpoint_dir / "evaluation.json").is_file():
                index = int(match.group(1))
                stage_log = read_stage_log(checkpoint_dir) if require_stages else None
                results[(problem_dir.name, index)] = _load_checkpoint(
                    problem_dir.name, index, checkpoint_dir, stage_log
                )
    return results


def read_stage_log(checkpoint_dir: Path) -> StageLog:
    plain = checkpoint_dir / AGENT_DIR / STAGES_FILE
    if plain.is_file():
        return _parse_stage_log(json.loads(plain.read_text()))
    tarball = checkpoint_dir / AGENT_TARBALL
    if tarball.is_file():
        with tarfile.open(tarball, "r:gz") as archive:
            member = next((m for m in archive.getmembers() if _is_stages_member(m)), None)
            if member is not None:
                return _parse_stage_log(json.load(archive.extractfile(member)))
    raise StagesNotFoundError(
        f"{checkpoint_dir}: no {AGENT_DIR}/{STAGES_FILE} and no {STAGES_FILE} in {AGENT_TARBALL}"
    )


def _is_stages_member(member: tarfile.TarInfo) -> bool:
    return member.isfile() and member.name.removeprefix("./") == STAGES_FILE


def _load_checkpoint(
    problem: str, index: int, checkpoint_dir: Path, stage_log: StageLog | None
) -> CheckpointResult:
    raw = json.loads((checkpoint_dir / "evaluation.json").read_text())
    groups = raw.get("tests") or {}
    quality = raw.get("quality")
    return CheckpointResult(
        problem=problem,
        index=index,
        strict=bool(groups) and all(_passed(g) for g in groups.values()),
        iso=bool(groups) and all(_passed(groups.get(n)) for n in NON_REGRESSION_GROUPS),
        core=_passed(groups.get("core")),
        cost_usd=_optional_float(raw.get("cost_usd")),
        erosion=_optional_float(quality.get("erosion")) if quality else None,
        verbosity=_optional_float(quality.get("verbosity")) if quality else None,
        files=_parse_files(quality.get("files")) if quality else None,
        stage_log=stage_log,
    )


def _passed(group: dict | None) -> bool:
    if not group:
        return False
    return group.get("total", 0) > 0 and group.get("passed") == group.get("total")


def _optional_float(value: object) -> float | None:
    return None if value is None else float(value)


def _parse_files(files: list | None) -> tuple[FileQuality, ...] | None:
    if files is None:
        return None
    return tuple(
        FileQuality(
            path=f["path"],
            loc=int(f.get("loc", 0)),
            flagged_lines=int(f.get("flagged_lines", 0)),
            callables=tuple(
                CallableMetric(cc=float(c["cc"]), sloc=int(c["sloc"]))
                for c in f.get("callables", [])
            ),
        )
        for f in files
    )


def _parse_stage_log(raw: dict) -> StageLog:
    return StageLog(
        stages=tuple(_parse_stage(s) for s in raw.get("stages", [])),
        mcp_tool_calls=int(raw.get("mcp_tool_calls", 0)),
    )


def _parse_stage(raw: dict) -> Stage:
    return Stage(
        name=raw["stage"],
        status=raw.get("status"),
        exit=raw.get("exit"),
        usd=float(raw.get("usd", 0.0)),
        items_in=int(raw.get("items_in", 0)),
        items_out=int(raw.get("items_out", 0)),
        outcome=raw.get("outcome"),
        fixed_replay_diffs=int(raw.get("fixed_replay_diffs", 0)),
        added_symbols=tuple(
            AddedSymbol(path=a["path"], name=a["name"], flags=tuple(a.get("flags", [])))
            for a in raw.get("added_symbols", [])
        ),
    )
