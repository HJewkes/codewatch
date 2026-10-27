"""The admission gate for test-gap commits: a new test stays only if it reaches code the rest
of the suite leaves unreached (C-262).

A new test is a test function the commit added under the tests directory: `test*` at module
level, or in a `Test*` class or a `TestCase` subclass, absent from the file's parent version.
A changed existing test is not gated, and no existing test is ever removed.

The gate runs the suite under coverage.py with branch measurement once without the new tests
(the base) and once per new test alone. A new test is admitted when it executes a line or an
arc of a source file that the base run did not; test files do not count. Every other new test
is rejected. The harness decides, never the agent: the fixer sends one fixed message naming
the rejected tests, gives the session one retry, and then reverts the commit. A coverage run
that does not complete rejects the commit, so a broken tool never admits a test.
"""

from __future__ import annotations

import ast
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from findings.diff_uncovered import AGENT_VENVS, agent_test_env

from .git import Git, GitError
from .session import Run
from .validate import Check

Reach = frozenset[str]

TESTS_RAN = (0, 1)
NO_TESTS = 5
PYTEST = ("-m", "pytest", "-q", "-p", "no:cacheprovider")


@dataclass(frozen=True)
class Verdict:
    admitted: tuple[str, ...] = ()
    rejected: tuple[str, ...] = ()
    error: str | None = None

    def check(self) -> Check:
        if self.error:
            return Check("admission", False, self.error)
        if self.rejected:
            return Check("admission", False, f"{len(self.rejected)} new tests reach nothing the rest of the "
                                             f"suite leaves unreached: {', '.join(self.rejected)}")
        return Check("admission", True, f"{len(self.admitted)} new tests admitted")


def retry_prompt(rejected: Sequence[str]) -> str:
    return (f"These new tests run no line or branch of the code that the other tests do not already run, so "
            f"they will not be kept: {', '.join(rejected)}.\nRemove them, or change them to exercise code no "
            "other test reaches, keep the suite passing, then stop.")


def judge(base: Reach, reaches: Mapping[str, Reach]) -> Verdict:
    admitted = tuple(sorted(t for t, reach in reaches.items() if reach - base))
    return Verdict(admitted, tuple(sorted(set(reaches) - set(admitted))))


def test_names(source: str) -> set[str]:
    """Pytest's node-id tails for the file's test functions: `test_x` or `TestBox::test_x`."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()
    names = {node.name for node in tree.body if _is_test_function(node)}
    for cls in (n for n in tree.body if isinstance(n, ast.ClassDef) and _is_test_class(n)):
        names |= {f"{cls.name}::{node.name}" for node in cls.body if _is_test_function(node)}
    return names


def _is_test_function(node: ast.stmt) -> bool:
    return isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name.startswith("test")


def _is_test_class(node: ast.ClassDef) -> bool:
    bases = {b.attr if isinstance(b, ast.Attribute) else getattr(b, "id", "") for b in node.bases}
    return node.name.startswith("Test") or any(b.endswith("TestCase") for b in bases)


def new_tests(git: Git, sha: str, tests_dir: str) -> list[str]:
    """The node ids of the test functions `sha` added to Python files under `tests_dir`."""
    added = []
    for path in sorted(git.files_in(sha)):
        file = git.workspace / path
        if not (path.startswith(f"{tests_dir}/") and path.endswith(".py") and file.is_file()):
            continue
        before = _parent_text(git, sha, path)
        fresh = test_names(file.read_text(errors="replace")) - test_names(before or "")
        added += [f"{path}::{name}" for name in sorted(fresh)]
    return added


def _parent_text(git: Git, sha: str, path: str) -> str | None:
    try:
        return git.run("show", f"{sha}^:{path}")
    except GitError:
        return None


def read_reach(report: Path, workspace: Path, tests_dir: str) -> Reach | None:
    """Executed lines (`path:12`) and arcs (`path:12->15`) of the workspace's source files."""
    try:
        files = json.loads(report.read_text()).get("files", {})
    except (OSError, ValueError, AttributeError):
        return None
    reach = set()
    for name, data in files.items():
        path = Path(os.path.relpath((workspace / name).resolve(), workspace.resolve())).as_posix()
        if path.startswith(("../", f"{tests_dir}/", *(f"{v}/" for v in AGENT_VENVS))):
            continue
        reach |= {f"{path}:{line}" for line in data.get("executed_lines", [])}
        reach |= {f"{path}:{a}->{b}" for a, b in data.get("executed_branches", [])}
    return frozenset(reach)


@dataclass(frozen=True)
class Coverage:
    """Runs pytest under the pinned coverage.py, as the audit's diff coverage does."""

    binary: str
    workspace: Path
    scratch: Path
    tests_dir: str
    run: Run

    def reach(self, selection: Sequence[str], timeout: float | None) -> Reach | None:
        rc, report = self._fresh()
        code = self._step(["run", rc, *PYTEST, *selection], timeout)
        if code == NO_TESTS:
            return frozenset()
        if code not in TESTS_RAN:
            return None
        if self._step(["combine", rc], timeout) != 0 or self._step(["json", rc, "-o", str(report)], timeout) != 0:
            return None
        return read_reach(report, self.workspace, self.tests_dir)

    def _step(self, args: list[str], timeout: float | None) -> int | None:
        env = agent_test_env(self.workspace, self.scratch)
        code, _, timed_out = self.run([self.binary, *args], env, str(self.workspace), timeout)
        return None if timed_out else code

    def _fresh(self) -> tuple[str, Path]:
        self.scratch.mkdir(parents=True, exist_ok=True)
        for old in self.scratch.glob(".coverage*"):
            old.unlink()
        report = self.scratch / "coverage.json"
        report.unlink(missing_ok=True)
        rcfile = self.scratch / "coveragerc"
        rcfile.write_text(f"[run]\nbranch = true\ndata_file = {self.scratch / '.coverage'}\n"
                          "parallel = true\npatch = subprocess\n")
        return f"--rcfile={rcfile}", report


@dataclass(frozen=True)
class Admission:
    git: Git
    coverage: Coverage

    def __call__(self, sha: str, timeout: float | None) -> Verdict:
        added = new_tests(self.git, sha, self.coverage.tests_dir)
        if not added:
            return Verdict()
        deselect = [arg for test in added for arg in ("--deselect", test)]
        base = self.coverage.reach([self.coverage.tests_dir, *deselect], timeout)
        reaches = {test: self.coverage.reach([test], timeout) for test in added}
        missing = [t for t, reach in reaches.items() if reach is None]
        if base is None or missing:
            what = "the base run" if base is None else ", ".join(missing)
            return Verdict(error=f"coverage did not complete for {what}")
        return judge(base, {t: r for t, r in reaches.items() if r is not None})
