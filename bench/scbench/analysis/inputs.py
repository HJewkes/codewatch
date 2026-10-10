"""Readers for `slop-code eval` output, A1's `stages.json`, and the tests-excluded rerun.

Everything that depends on slop-code-bench's on-disk format lives in this module. The
format is read from the runner's own code at commit 31ceea3 (`common/constants.py`,
`metrics/checkpoint/extractors.py`, `metrics/checkpoint/driver.py`,
`entrypoints/evaluation/metrics.py`, `agent_runner/reporting.py`) and checked against
one real eval output. Layout, one run directory per arm:

    <arm>/checkpoint_results.jsonl                  one row per checkpoint; official
                                                    erosion and verbosity (scb-check)
    <arm>/<problem>/checkpoint_<n>/evaluation.json  pass_counts / total_counts
    <arm>/<problem>/checkpoint_<n>/inference_result.json   usage.cost
    <arm>/<problem>/checkpoint_<n>/snapshot/        the graded workspace
    <arm>/<problem>/checkpoint_<n>/agent/stages.json      (A1; or inside agent.tar.gz)

`evaluation.json` keys read: `pass_counts` and `total_counts`, each keyed Core,
Functionality, Error and Regression, plus `pytest_collected`. Strict needs every test
to pass, ISO every non-Regression test, core every Core test (paper section 2.4).

`checkpoint_results.jsonl` keys read: `problem`, `checkpoint` (the runner's directory
name), `erosion` and `verbosity`. Both come from `scb-check==0.1.3 check --report
--include-all <snapshot>`, and are absent when scb-check failed. That checkpoint then
drops out of the quality means but still counts in the solve denominators.
`quality_analysis/` (overall_quality.json, files.jsonl, symbols.jsonl) holds
slop-code's own radon metrics, not the official scores, so it is not read.

scb-check scans test files too, so the tests-excluded sensitivity run re-runs the same
pinned scb-check on a copy of `snapshot/` without the agent's tests directory. Only the
report's totals (`erosion`, `verbosity`) are read; no per-rule data is (design section 3).

Checkpoints are keyed by the runner's `checkpoint_<n>` directory, never by the agent's
own `checkpoint` field in stages.json, which restarts at 1 after `--resume`.

`stages.json`, as the A1 stage-hook agent (`bench/scbench/agent/stages.py`) writes it:

    {"checkpoint": 2, "mcp_tool_calls": 3,
     "stages": [{"stage": "index", "status": "disabled", "start": null, "end": null,
                 "exit": null, "tokens": 0, "usd": 0.0, "items_in": 0, "items_out": 0},
                {"stage": "remediation", "status": "ok", "exit": 0, "usd": 0.31, ...,
                 "outcome": "kept", "held_back": 0,
                 "items": [{"phase": 2, "kind": "quality", "status": "kept", "resumed": false,
                            "review": {"verdict": "ok"}, "missing": null,
                            "added_symbols": [{"path": "src/a.py", "name": "_h",
                                               "flags": ["single-caller-helper"]}]}]}]}

`status` is one of disabled, missing, skipped_budget (the command never ran, exit
null), ok, failed or timeout.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

CHECKPOINT_RESULTS = "checkpoint_results.jsonl"
EVALUATION_FILE = "evaluation.json"
INFERENCE_FILE = "inference_result.json"
SNAPSHOT_DIR = "snapshot"
AGENT_DIR = "agent"
AGENT_TARBALL = "agent.tar.gz"
STAGES_FILE = "stages.json"
SCB_CHECK_VERSION = "0.1.3"
CHECKPOINT_DIR = re.compile(r"^checkpoint_(\d+)$")

Report = dict
ScbCheck = Callable[[Path], Report]


@dataclass(frozen=True)
class AddedSymbol:
    path: str
    name: str
    flags: tuple[str, ...]


@dataclass(frozen=True)
class FixItem:
    """One fix item of the `fix` stage: a single commit, kept or reverted (design U8)."""

    phase: int
    kind: str
    signal: str
    status: str
    resumed: bool
    review_verdict: str | None
    missing: str | None
    added_symbols: tuple[AddedSymbol, ...]


@dataclass(frozen=True)
class Stage:
    name: str
    status: str | None
    exit: int | None
    usd: float
    items_in: int
    items_out: int
    outcome: str | None
    items: tuple[FixItem, ...] = ()
    held_back: int = 0

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
class Rerun:
    """scb-check on the whole snapshot (parity with the recorded score) and without tests."""

    erosion_full: float | None
    verbosity_full: float | None
    erosion_ex_tests: float | None
    verbosity_ex_tests: float | None


@dataclass(frozen=True)
class RerunSettings:
    tests_dirs: tuple[str, ...]
    scratch: Path
    scb_check: ScbCheck


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
    rerun: Rerun | None
    stage_log: StageLog | None


class StagesNotFoundError(FileNotFoundError):
    pass


class EvalOutputError(FileNotFoundError):
    pass


def load_arm(
    arm_dir: Path, require_stages: bool = False, rerun: RerunSettings | None = None
) -> dict[tuple[str, int], CheckpointResult]:
    """Load one arm. `require_stages` is set for A1, whose agent always writes stages.json."""
    scores = _read_official_scores(arm_dir)
    results = {}
    for problem_dir in sorted(p for p in arm_dir.iterdir() if p.is_dir()):
        for checkpoint_dir in sorted(problem_dir.iterdir()):
            match = CHECKPOINT_DIR.match(checkpoint_dir.name)
            if match and (checkpoint_dir / EVALUATION_FILE).is_file():
                key = (problem_dir.name, int(match.group(1)))
                score = scores.get((problem_dir.name, checkpoint_dir.name), {})
                stage_log = read_stage_log(checkpoint_dir) if require_stages else None
                rerun_result = _rerun(checkpoint_dir, rerun) if rerun else None
                results[key] = _load_checkpoint(key, checkpoint_dir, score, stage_log, rerun_result)
    return results


def _read_official_scores(arm_dir: Path) -> dict[tuple[str, str], dict]:
    path = arm_dir / CHECKPOINT_RESULTS
    if not path.is_file():
        raise EvalOutputError(f"{arm_dir}: no {CHECKPOINT_RESULTS}; run `slop-code eval` on it first")
    rows = (json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return {(row["problem"], row["checkpoint"]): row for row in rows}


def _load_checkpoint(
    key: tuple[str, int], checkpoint_dir: Path, score: dict, stage_log, rerun
) -> CheckpointResult:
    evaluation = json.loads((checkpoint_dir / EVALUATION_FILE).read_text())
    strict, iso, core = solve_flags(evaluation)
    return CheckpointResult(
        problem=key[0],
        index=key[1],
        strict=strict,
        iso=iso,
        core=core,
        cost_usd=_read_cost(checkpoint_dir / INFERENCE_FILE),
        erosion=_number(score.get("erosion")),
        verbosity=_number(score.get("verbosity")),
        rerun=rerun,
        stage_log=stage_log,
    )


def solve_flags(evaluation: dict) -> tuple[bool, bool, bool]:
    """Strict, ISO and core, mirroring extractors.get_evaluation_metrics at pass rate 1.0."""
    passed = evaluation.get("pass_counts") or {}
    totals = evaluation.get("total_counts") or {}
    total = sum(totals.values()) or int(evaluation.get("pytest_collected") or 0)
    passed_all = sum(passed.values())
    iso_total = total - totals.get("Regression", 0)
    iso_passed = passed_all - passed.get("Regression", 0)
    core_total = totals.get("Core", 0)
    return (
        total > 0 and passed_all == total,
        iso_total > 0 and iso_passed == iso_total,
        core_total > 0 and passed.get("Core", 0) == core_total,
    )


def _read_cost(path: Path) -> float | None:
    if not path.is_file():
        return None
    return _number((json.loads(path.read_text()).get("usage") or {}).get("cost"))


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def is_test_path(path: str, tests_dirs: tuple[str, ...]) -> bool:
    normalised = path.replace("\\", "/")
    while normalised.startswith("./"):
        normalised = normalised[2:]
    return any(normalised == d or normalised.startswith(d.rstrip("/") + "/") for d in tests_dirs)


def _rerun(checkpoint_dir: Path, settings: RerunSettings) -> Rerun | None:
    snapshot = checkpoint_dir / SNAPSHOT_DIR
    if not snapshot.is_dir():
        return None
    full = _safe_check(settings.scb_check, snapshot)
    settings.scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=settings.scratch) as scratch:
        copy = Path(scratch) / SNAPSHOT_DIR
        shutil.copytree(snapshot, copy, ignore=_ignore_tests(snapshot, settings.tests_dirs))
        excluded = _safe_check(settings.scb_check, copy)
    return Rerun(
        erosion_full=_number(full.get("erosion")),
        verbosity_full=_number(full.get("verbosity")),
        erosion_ex_tests=_number(excluded.get("erosion")),
        verbosity_ex_tests=_number(excluded.get("verbosity")),
    )


def _ignore_tests(root: Path, tests_dirs: tuple[str, ...]) -> Callable[[str, list[str]], set[str]]:
    def ignore(directory: str, names: list[str]) -> set[str]:
        relative = Path(directory).relative_to(root)
        return {n for n in names if is_test_path((relative / n).as_posix(), tests_dirs)}

    return ignore


def _safe_check(scb_check: ScbCheck, path: Path) -> Report:
    try:
        return scb_check(path)
    except (subprocess.CalledProcessError, OSError, json.JSONDecodeError) as error:
        print(f"scb-check failed on {path}: {error}", file=sys.stderr)
        return {}


def run_scb_check(path: Path) -> Report:
    """The same pinned invocation as slop-code's metrics/checkpoint/driver.py."""
    command = ["uvx", f"scb-check=={SCB_CHECK_VERSION}", "check", "--report", "--include-all", str(path)]
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(completed.stdout)


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


def _parse_stage_log(raw: dict) -> StageLog:
    return StageLog(
        stages=tuple(_parse_stage(s) for s in raw.get("stages", [])),
        mcp_tool_calls=int(raw.get("mcp_tool_calls", 0)),
    )


def _parse_symbols(rows: list[dict]) -> tuple[AddedSymbol, ...]:
    return tuple(AddedSymbol(path=a["path"], name=a["name"], flags=tuple(a.get("flags", []))) for a in rows)


def _parse_item(raw: dict) -> FixItem:
    return FixItem(
        phase=int(raw.get("phase", 0)), kind=raw.get("kind", ""), signal=raw.get("signal", ""),
        status=raw.get("status", ""), resumed=raw.get("resumed") is True,
        review_verdict=(raw.get("review") or {}).get("verdict"), missing=raw.get("missing"),
        added_symbols=_parse_symbols(raw.get("added_symbols", [])),
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
        items=tuple(_parse_item(i) for i in raw.get("items", [])),
        held_back=int(raw.get("held_back", 0)),
    )
