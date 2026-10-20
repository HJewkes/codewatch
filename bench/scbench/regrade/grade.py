"""Stage a tree as the bench snapshots it, then score it with the hidden tests and scb-check."""

from __future__ import annotations

import fnmatch
import json
import shutil
import stat
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from analysis.inputs import SCB_CHECK_VERSION, ScbCheck, is_test_path

# The runner's snapshot.ignore_globs (the A1a run's environment.yaml), plus `.git`: the
# bench workspace has none, while frozen C-239 copies are git repositories.
SNAPSHOT_IGNORES = (
    "*.pyc", ".opencode", "node_modules", "__pycache__", ".evaluation_tests", ".mypy_cache",
    ".venv", ".ruff_cache", ".claude", "venv", ".pytest_cache", ".codewatch", ".git",
)
EVAL_SCRIPT = Path(__file__).resolve().parent.parent / "c239" / "harness" / "eval.sh"
PARITY_TOLERANCE = 1e-9
METRICS = ("erosion", "verbosity", "erosion_ex_tests", "verbosity_ex_tests")

HiddenEval = Callable[[Path, Path], dict]


@dataclass(frozen=True)
class Graders:
    scb_check: ScbCheck
    hidden_eval: HiddenEval | None
    tests_dirs: tuple[str, ...] = ("tests",)


def snapshot_root(path: Path) -> Path:
    """A seed checkpoint (`checkpoint_N/` with `snapshot/`) or a plain tree."""
    return path / "snapshot" if (path / "snapshot").is_dir() else path


def _ignore(root: Path, tests_dirs: tuple[str, ...]):
    def ignore(directory: str, names: list[str]) -> set[str]:
        relative = Path(directory).relative_to(root)
        skipped = {n for n in names if any(fnmatch.fnmatch(n, g) for g in SNAPSHOT_IGNORES)}
        return skipped | {n for n in names if is_test_path((relative / n).as_posix(), tests_dirs)}

    return ignore


def stage(tree: Path, destination: Path, tests_dirs: tuple[str, ...] = ()) -> Path:
    """A writable copy of `tree` as the runner snapshots it; non-empty `tests_dirs` are left out too.

    Seeds are frozen read-only, and the hidden-test eval writes into its copy of the tree.
    """
    shutil.copytree(tree, destination, ignore=_ignore(tree, tests_dirs), symlinks=True)
    for path in (destination, *destination.rglob("*")):
        if not path.is_symlink():
            path.chmod(path.stat().st_mode | stat.S_IWUSR)
    return destination


def score_tree(tree: Path, graders: Graders, scratch: Path) -> dict:
    with tempfile.TemporaryDirectory(dir=scratch) as work:
        snapshot = stage(tree, Path(work) / "full" / "snapshot")
        full = graders.scb_check(snapshot)
        excluded = graders.scb_check(stage(tree, Path(work) / "ex_tests" / "snapshot", graders.tests_dirs))
        hidden = graders.hidden_eval(snapshot, scratch) if graders.hidden_eval else None
    score = {
        "erosion": full.get("erosion"), "verbosity": full.get("verbosity"),
        "erosion_ex_tests": excluded.get("erosion"), "verbosity_ex_tests": excluded.get("verbosity"),
        "files_scanned": full.get("files_scanned"), "total_loc": full.get("total_loc"),
    }
    if hidden is not None:
        score["hidden"] = hidden
    return score


def recorded_score(results_file: Path, problem: str, checkpoint: int) -> dict | None:
    """The runner's official erosion and verbosity for one checkpoint (checkpoint_results.jsonl)."""
    for line in results_file.read_text().splitlines():
        row = json.loads(line) if line.strip() else {}
        if row.get("problem") == problem and row.get("checkpoint") == f"checkpoint_{checkpoint}":
            keys = ("erosion", "verbosity", "scb_check_version")
            return {k: row.get(k) for k in keys}
    return None


def recorded_hidden(base: Path) -> dict | None:
    evaluation = base / "evaluation.json"
    if not evaluation.is_file():
        return None
    data = json.loads(evaluation.read_text())
    return {"passed": sum((data.get("pass_counts") or {}).values()),
            "total": sum((data.get("total_counts") or {}).values())}


def parity(recorded: dict | None, base_hidden_recorded: dict | None, before: dict) -> dict:
    """Does the base's rerun reproduce what the bench recorded for it?"""
    gaps = {m: abs(before[m] - recorded[m]) for m in ("erosion", "verbosity")
            if recorded and recorded.get(m) is not None and before.get(m) is not None}
    hidden = before.get("hidden")
    hidden_ok = None
    if base_hidden_recorded and hidden:
        hidden_ok = (hidden["passed"], hidden["total"]) == (
            base_hidden_recorded["passed"], base_hidden_recorded["total"])
    scores_ok = None
    if recorded:
        scores_ok = len(gaps) == 2 and all(g <= PARITY_TOLERANCE for g in gaps.values())
    return {"gaps": gaps, "scores_ok": scores_ok, "hidden_ok": hidden_ok}


def delta(before: dict, after: dict) -> dict:
    return {m: after[m] - before[m] for m in METRICS
            if isinstance(before.get(m), float) and isinstance(after.get(m), float)}


def regrade(base: Path, head: Path, graders: Graders, scratch: Path, recorded: dict | None) -> dict:
    scratch.mkdir(parents=True, exist_ok=True)
    before = score_tree(snapshot_root(base), graders, scratch)
    after = score_tree(snapshot_root(head), graders, scratch)
    return {
        "scb_check_version": SCB_CHECK_VERSION, "tests_dirs": list(graders.tests_dirs),
        "base": str(base), "head": str(head), "recorded": recorded,
        "parity": parity(recorded, recorded_hidden(base), before),
        "before": before, "after": after, "delta": delta(before, after),
    }


def bench_hidden_eval(problem: str, checkpoint: int) -> HiddenEval:
    """The calibrated C-239 eval: the bench's uv + pytest run over test_checkpoint_1..N."""

    def run(tree: Path, scratch: Path) -> dict:
        out = Path(tempfile.mkdtemp(prefix="eval-", dir=scratch))
        command = ["bash", str(EVAL_SCRIPT), problem, str(checkpoint), str(tree), str(out)]
        subprocess.run(command, check=True, capture_output=True, text=True)
        summary = json.loads((out / "summary.json").read_text())
        shutil.rmtree(out / "ws", ignore_errors=True)
        return summary

    return run


def table_row(label: str, result: dict) -> str:
    before, after = result["before"], result["after"]

    def pair(metric: str) -> str:
        b, a = before.get(metric), after.get(metric)
        return "n/a" if b is None or a is None else f"{b:.3f} → {a:.3f}"

    def hidden(score: dict) -> str:
        h = score.get("hidden")
        return f"{h['passed']}/{h['total']}" if h else "n/a"

    hidden_cell = f"{hidden(before)} → {hidden(after)}"
    return f"| {label} | {hidden_cell} | " + " | ".join(pair(m) for m in METRICS) + " |"
