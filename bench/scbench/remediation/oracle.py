"""The fix stage's test check: proven once at the stage base, then judged against that base.

The preflight runs the check at the base, before any item, and classifies it: `pass`,
`base-failing` (with the ids of the failing tests), or `unavailable` (with the reason). An
unavailable check would revert every item, so the stage starts none.

An item's check passes when it adds no failure the base did not have. pytest names its
failures in the short test summary; each new one is rerun once, and one that passes on the
rerun is recorded as flaky rather than counted against the item. A custom test command
names no tests, so it is judged by its exit code, and a base it fails is unavailable.
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
SUMMARY_HEADER = "short test summary info"
SUMMARY_LINE = re.compile(r"^(?:FAILED|ERROR) (.+?)(?: - .*)?$")
PASS, BASE_FAILING, UNAVAILABLE = "pass", "base-failing", "unavailable"


@dataclass(frozen=True)
class Result:
    code: int | None
    timed_out: bool
    failing: frozenset[str]

    @property
    def passed(self) -> bool:
        return not self.timed_out and self.code in PASSING_EXITS


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


@dataclass(frozen=True)
class TestRunner:
    workspace: Path
    command: TestCommand
    tests_dir: str
    run: Run
    base: frozenset[str] = field(default_factory=frozenset)

    def _run(self, argv: Sequence[str], env: Mapping[str, str], timeout: float | None) -> Result:
        code, stdout, timed_out = self.run(argv, self.command.env(env), str(self.workspace), timeout)
        return Result(code, timed_out, failing_ids(stdout) if self.command.prefix else frozenset())

    def _has_tests(self) -> bool:
        return (self.workspace / self.tests_dir).is_dir()

    def preflight(self, env: Mapping[str, str], timeout: float | None) -> Baseline:
        if not self._has_tests():
            return Baseline(PASS, frozenset(), f"no {self.tests_dir}/ directory")
        result = self._run(self.command.argv(), env, timeout)
        if result.timed_out:
            return Baseline(UNAVAILABLE, frozenset(), "the test check timed out at the base")
        if result.passed:
            return Baseline(PASS, frozenset(), f"exit {result.code}")
        if not self.command.prefix:
            return Baseline(UNAVAILABLE, frozenset(), f"the custom test command fails at the base (exit "
                                                      f"{result.code}); judged by exit code, it would revert every item")
        if not result.failing:
            return Baseline(UNAVAILABLE, frozenset(), f"the test check fails at the base (exit {result.code}) "
                                                      "and names no failing test")
        return Baseline(BASE_FAILING, result.failing, f"exit {result.code}")

    def __call__(self, env: Mapping[str, str], timeout: float | None) -> Check:
        if not self._has_tests():
            return Check("tests", True, f"no {self.tests_dir}/ directory")
        result = self._run(self.command.argv(), env, timeout)
        if result.timed_out:
            return Check("tests", False, "tests timed out")
        if result.passed or not result.failing:
            return Check("tests", result.passed, f"exit {result.code}")
        new = result.failing - self.base
        if not new:
            return Check("tests", True, f"no new failure ({len(result.failing)} failing at the base)")
        return self._rerun(sorted(new), env, timeout)

    def _rerun(self, new: list[str], env: Mapping[str, str], timeout: float | None) -> Check:
        """A rerun that fails naming no test, or times out, reproduces every new failure."""
        result = self._run(self.command.rerun_argv(new), env, timeout)
        unexplained = not result.passed and not result.failing
        reproduced = [t for t in new if unexplained or t in result.failing]
        if reproduced:
            return Check("tests", False, f"new failures: {', '.join(reproduced[:5])}")
        return Check("tests", True, f"no new failure after a rerun ({len(new)} flaky)", tuple(new))
