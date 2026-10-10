"""The review's three inputs: the commit diff, the checkpoint spec and NOTES.md.

The diff comes from `git show` in the stage's environment, so `GIT_DIR` points at the
hidden repository. In `expected-output` mode (the solve commit) only the files that
change expected outputs are kept: snapshot or golden files, and test files whose diff
removes an assertion line.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path, PurePosixPath

MAX_DIFF_CHARS = 40_000
MAX_NOTES_CHARS = 8_000
GOLDEN_DIRS = frozenset({"__snapshots__", "snapshots", "golden", "goldens", "expected"})
GOLDEN_SUFFIXES = frozenset({".snap", ".golden", ".ambr", ".approved"})
FILE_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$", re.MULTILINE)
REMOVED_ASSERT = re.compile(r"^-(?!--)\s*(assert\b|self\.assert|pytest\.raises)", re.MULTILINE)


class InputError(RuntimeError):
    pass


def _inside(directory: Path, file: Path) -> bool:
    return file == directory or directory in file.parents


def read_spec(file: Path, workspace: Path) -> list[str]:
    """The spec's lines. A file inside the workspace is refused, so the spec never sits where the agent reads."""
    real = file.resolve()
    if _inside(workspace.resolve(), real):
        raise InputError(f"--spec {file} is inside the workspace; pass a file outside it")
    if not real.is_file():
        raise InputError(f"--spec {file} is not a file")
    return real.read_text(encoding="utf-8").splitlines()


def read_notes(workspace: Path) -> str:
    notes = workspace / "NOTES.md"
    return notes.read_text(encoding="utf-8")[:MAX_NOTES_CHARS] if notes.is_file() else ""


def commit_diff(sha: str, workspace: Path) -> str:
    done = subprocess.run(["git", "show", "--no-color", "--format=", sha], cwd=workspace,
                          capture_output=True, text=True, check=False)
    if done.returncode != 0:
        raise InputError(f"git show {sha}: {done.stderr.strip()}")
    return done.stdout


def split_files(diff: str) -> list[tuple[str, str]]:
    """(path, section) for each file in a `git show` diff."""
    starts = list(FILE_HEADER.finditer(diff))
    ends = [m.start() for m in starts[1:]] + [len(diff)]
    return [(m.group(2), diff[m.start():end]) for m, end in zip(starts, ends)]


def is_golden(path: str) -> bool:
    pure = PurePosixPath(path)
    return bool(GOLDEN_DIRS & set(pure.parts[:-1])) or pure.suffix in GOLDEN_SUFFIXES or ".expected." in pure.name


def is_test_file(path: str, tests_dir: str) -> bool:
    pure = PurePosixPath(path)
    return pure.parts[:1] == (tests_dir,) or pure.name.startswith("test_") or pure.stem.endswith("_test")


def changes_expected_output(path: str, section: str, tests_dir: str) -> bool:
    return is_golden(path) or (is_test_file(path, tests_dir) and bool(REMOVED_ASSERT.search(section)))


def expected_output_diff(diff: str, tests_dir: str) -> tuple[str, list[str]]:
    kept = [(p, s) for p, s in split_files(diff) if changes_expected_output(p, s, tests_dir)]
    return "".join(s for _, s in kept), [p for p, _ in kept]


def cap_diff(diff: str, limit: int = MAX_DIFF_CHARS) -> str:
    return diff if len(diff) <= limit else diff[:limit] + "\n[diff cut here: too long to show in full]\n"
