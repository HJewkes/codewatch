"""The fix stage's test check: proven once at the stage base, then judged against that base.

Every run of the check gets one status from its exit code and its output together:
`passed` (exit 0, or 5 for no tests), `failed` (pytest's exit 1, naming its failing tests
in the short summary), or `unjudgeable` (anything else: a timeout, an interrupted or broken
run such as a collection error, an exit 1 naming no test, or a custom command's failure).
Only a `failed` run can be compared test by test, and the preflight, the item check and the
rerun all branch on that status alone.

The preflight runs the check at the base, before any item: `passed` is `pass`, `failed` is
`base-failing` (with the failing ids), and `unjudgeable` is `unavailable` (with the reason).
A pytest command that stops at a failure (`-x`, `--maxfail`) names only some of them, so
it is unavailable without a run. An unavailable check would judge nothing, so no item starts.

An item's check passes when it adds no failure the base did not have. Each new failure is
rerun once, and one that passes on the rerun is recorded as flaky rather than counted
against the item. A custom test command names no tests, so it is judged by its exit code.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from .interpreter import TestCommand
from .session import Run
from .validate import Check

PASSING_EXITS = (0, 5)
TESTS_FAILED = 1
SUMMARY_HEADER = "short test summary info"
SUMMARY_LINE = re.compile(r"^(?:FAILED|ERROR) (\S*?\[.*?\](?= - |$)|\S+)")
PASSED, FAILED, UNJUDGEABLE = "passed", "failed", "unjudgeable"
PASS, BASE_FAILING, UNAVAILABLE = "pass", "base-failing", "unavailable"


@dataclass(frozen=True)
class Result:
    status: str
    detail: str
    failing: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Baseline:
    kind: str
    failing: frozenset[str]
    reason: str

    def report(self) -> dict:
        return {"class": self.kind, "failing": sorted(self.failing), "reason": self.reason}


def failing_ids(stdout: str) -> frozenset[str]:
    """The tests pytest's short summary lists as failed or errored."""
    lines = stdout.splitlines()
    start = next((n for n, line in enumerate(lines) if SUMMARY_HEADER in line), len(lines))
    return frozenset(m.group(1) for line in lines[start + 1:] if (m := SUMMARY_LINE.match(line)))


def classify(code: int | None, stdout: str, timed_out: bool, names_tests: bool) -> Result:
    if timed_out:
        return Result(UNJUDGEABLE, "tests timed out")
    if code in PASSING_EXITS:
        return Result(PASSED, f"exit {code}")
    failing = failing_ids(stdout) if names_tests and code == TESTS_FAILED else frozenset()
    return Result(FAILED, f"exit {code}", failing) if failing else Result(UNJUDGEABLE, f"exit {code}")


@dataclass(frozen=True)
class TestRunner:
    workspace: Path
    command: TestCommand
    tests_dir: str
    run: Run
    base: frozenset[str] = field(default_factory=frozenset)

    def _run(self, argv: Sequence[str], env: Mapping[str, str], timeout: float | None) -> Result:
        code, stdout, timed_out = self.run(argv, self.command.env(env), str(self.workspace), timeout)
        return classify(code, stdout, timed_out, bool(self.command.prefix))

    def _has_tests(self) -> bool:
        return (self.workspace / self.tests_dir).is_dir()

    def preflight(self, env: Mapping[str, str], timeout: float | None) -> Baseline:
        if not self._has_tests():
            return Baseline(PASS, frozenset(), f"no {self.tests_dir}/ directory")
        if option := self.command.stop_early_option():
            return Baseline(UNAVAILABLE, frozenset(), f"the test command stops at a failure ({option}), "
                                                      "so it cannot name every failure at the base")
        result = self._run(self.command.argv(), env, timeout)
        if result.status == PASSED:
            return Baseline(PASS, frozenset(), result.detail)
        if result.status == FAILED:
            return Baseline(BASE_FAILING, result.failing, result.detail)
        return Baseline(UNAVAILABLE, frozenset(), f"the test check cannot be judged at the base ({result.detail}): "
                                                  "a run must pass, or exit 1 naming its failing tests")

    def __call__(self, env: Mapping[str, str], timeout: float | None) -> Check:
        if not self._has_tests():
            return Check("tests", True, f"no {self.tests_dir}/ directory")
        result = self._run(self.command.argv(), env, timeout)
        if result.status != FAILED:
            return Check("tests", result.status == PASSED, result.detail)
        new = result.failing - self.base
        if not new:
            return Check("tests", True, f"no new failure ({len(result.failing)} failing at the base)")
        return self._rerun(sorted(new), env, timeout)

    def _rerun(self, new: list[str], env: Mapping[str, str], timeout: float | None) -> Check:
        """Only a passing rerun clears the new failures. A failing one reproduces those it names,
        or every one when it names none of them or cannot be judged."""
        result = self._run(self.command.rerun_argv(new), env, timeout)
        if result.status == PASSED:
            return Check("tests", True, f"no new failure after a rerun ({len(new)} flaky)", tuple(new))
        reproduced = [t for t in new if t in result.failing] or new
        return Check("tests", False, f"new failures: {', '.join(reproduced[:5])}")
