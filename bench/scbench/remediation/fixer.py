"""One validated commit per item: propose, check, review, then keep or revert that commit alone.

A phase-1 commit may touch only the tests directory and must leave the suite green. A
phase-2 or phase-3 commit must leave the suite green and add no ratchet violation. A
commit that passes goes to the review hook (U17); on a conflict the session is resumed
once, and the commit is reverted if the conflict stands. A phase-3 item works on its own
branch from the PR branch, merged back only when kept.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from .git import Git
from .items import Item
from .session import FixSession, conflict_prompt, first_prompt, render_item
from .validate import Check, GraphCheck, Reviewer, Snapshot, TestRunner, ratchet_check

TIME_LIMIT = "time limit"
FIX_REF = "cw-fix"


class TimeLimitReached(Exception):
    pass


@dataclass(frozen=True)
class Clock:
    """Stops new work `margin` seconds before the stage deadline, leaving time for the reset."""

    deadline: float | None
    margin: float
    now: Callable[[], float] = time.time

    def remaining(self) -> float | None:
        """The timeout for checks: everything left before the deadline."""
        return None if self.deadline is None else max(self.deadline - self.now(), 0.0)

    def call_timeout(self) -> float | None:
        """The timeout for a session call, which must leave the margin for checks and the reset."""
        left = self.remaining()
        return None if left is None else max(left - self.margin, 0.0)

    def may_start(self) -> bool:
        left = self.remaining()
        return left is None or left > self.margin


@dataclass
class Fixer:
    git: Git
    session: FixSession
    tests: TestRunner
    graph: GraphCheck
    reviewer: Reviewer
    clock: Clock
    env: Mapping[str, str]
    tests_dir: str
    base_branch: str
    kept_head: str
    current: Snapshot | None
    stale: bool = False
    feedback: str = ""

    def fix(self, n: int, item: Item) -> dict:
        if item.phase > 1 and self.stale:
            self.current, self.stale = self.graph.snapshot(FIX_REF, self.clock.remaining()), False
        if item.phase > 1 and self.current is None:
            return {"status": "not-started", "reason": "graph check could not run"}
        branch = f"cw-backlog-{n}" if item.phase == 3 else None
        if branch:
            self.git.switch(branch, create=True)
        try:
            outcome = self._attempt(n, item)
        except TimeLimitReached as reached:
            outcome = {"status": TIME_LIMIT, "reason": str(reached)}
        if branch and outcome["status"] != TIME_LIMIT:
            self._land(branch, outcome)
        if outcome["status"] == "kept":
            self.kept_head = self.git.head()
        return outcome

    def _attempt(self, n: int, item: Item) -> dict:
        before = self.current
        text = render_item(n, item, self.feedback)
        call = self._ask(text if self.session.started else first_prompt(text))
        self.feedback = ""
        if not self.git.dirty():
            return {"status": "unchanged", "reason": f"no edit (session ended: {call.subtype})"}
        sha = self.git.commit_all(f"codewatch fix {n}: {item.signal} in {item.path}")
        check, after = self._validate(item, sha, before)
        review, resumed = None, False
        if check.passed:
            sha, check, after, review, resumed = self._review(n, item, sha, before, after)
        if not check.passed:
            self.git.revert(sha)
            self.feedback = f"Your change for item {n} was reverted ({check.name}: {check.detail})."
            return {"status": "reverted", "commit": sha, "reason": f"{check.name}: {check.detail}",
                    "review": review, "resumed": resumed}
        return self._kept(item, sha, before, after, review, resumed)

    def _review(self, n: int, item: Item, sha: str, before: Snapshot | None, after: Snapshot | None):
        review = self.reviewer(sha, self.clock.remaining())
        if review["verdict"] != "conflict":
            return sha, Check("review", True, review["verdict"]), after, review, False
        self._ask(conflict_prompt(review.get("reason") or "", review.get("spec_line")))
        if self.git.dirty():
            sha = self.git.commit_all(f"codewatch fix {n}: {item.signal} in {item.path}", amend=True)
            check, after = self._validate(item, sha, before)
            if not check.passed:
                return sha, check, after, review, True
            review = self.reviewer(sha, self.clock.remaining())
        passed = review["verdict"] != "conflict"
        detail = review["verdict"] if passed else f"conflict after one resume: {review.get('reason')}"
        return sha, Check("review", passed, detail), after, review, True

    def _ask(self, prompt: str):
        call = self.session.ask(prompt, self.clock.call_timeout())
        if call.timed_out:
            raise TimeLimitReached("the session reached the time limit")
        return call

    def _validate(self, item: Item, sha: str, before: Snapshot | None) -> tuple[Check, Snapshot | None]:
        if item.phase == 1:
            outside = sorted(p for p in self.git.files_in(sha) if not p.startswith(f"{self.tests_dir}/"))
            if outside:
                return Check("scope", False, f"phase 1 changed files outside {self.tests_dir}/: {', '.join(outside)}"), None
        tests = self.tests(self.env, self.clock.remaining())
        if not tests.passed or item.phase == 1:
            return tests, None
        after = self.graph.snapshot(FIX_REF, self.clock.remaining())
        return ratchet_check(before, after), after

    def _kept(self, item: Item, sha: str, before: Snapshot | None, after: Snapshot | None,
              review: dict | None, resumed: bool) -> dict:
        added: list[dict] = []
        if item.phase == 1:
            self.stale = True
        elif before is not None and after is not None:
            added = self.graph.added_symbols(before.id, after.id, self.clock.remaining())
            self.current = after
        return {"status": "kept", "commit": sha, "reason": "checks passed", "review": review,
                "resumed": resumed, "added_symbols": added}

    def _land(self, branch: str, outcome: dict) -> None:
        self.git.switch(self.base_branch)
        if outcome["status"] == "kept":
            self.git.merge(branch, f"Merge {branch}")
        elif outcome["status"] == "reverted":
            outcome["reason"] += f"; {branch} not merged"
