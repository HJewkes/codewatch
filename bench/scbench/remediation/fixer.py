"""One validated commit per item: propose, check, review, then keep or revert that commit alone.

A test-gap commit, in any phase, may touch only the tests directory and must add no test
failure the stage base did not have, and must pass the admission gate (`admission`): each new
test reaches a line or branch the rest of the suite does not, after at most one retry. A
quality commit must add no such failure and no ratchet violation. A test failure that passes on its rerun is recorded as flaky on the item. A
commit that passes goes to the review hook (U17); on a conflict the session is resumed
once, and the commit is reverted if the conflict stands. Every amend, after the gate's retry
or the review's resume, is validated and gated again. A phase-3 item works on its own
branch from the PR branch, merged back only when kept.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from prflow.repo import scoped

from .admission import Admission, Verdict, retry_prompt
from .git import Git
from .items import TEST_GAP, Item
from .oracle import TestRunner
from .session import FixSession, conflict_prompt, first_prompt, render_item
from .validate import Check, GraphCheck, Reviewer, Snapshot, ratchet_check

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
    admission: Admission | None = None
    stale: bool = False
    feedback: str = ""
    flaky: tuple[str, ...] = ()
    gated: dict | None = None
    review_tokens: int = 0
    review_usd: float = 0.0

    @property
    def fix_ref(self) -> str:
        return scoped(FIX_REF, self.base_branch)

    def fix(self, n: int, item: Item) -> dict:
        tests_only = item.kind == TEST_GAP
        if not tests_only and self.stale:
            self.current, self.stale = self.graph.snapshot(self.fix_ref, self.clock.remaining()), False
        if not tests_only and self.current is None:
            return {"status": "not-started", "reason": "graph check could not run"}
        if tests_only and self.admission is None:
            return {"status": "not-started", "reason": "admission gate could not run: no coverage binary"}
        branch = scoped(f"cw-backlog-{n}", self.base_branch) if item.phase == 3 else None
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
        before, self.flaky, self.gated = self.current, (), None
        text = render_item(n, item, self.feedback)
        call = self._ask(text if self.session.started else first_prompt(text))
        self.feedback = ""
        if not self.git.dirty():
            return {"status": "unchanged", "reason": f"no edit (session ended: {call.subtype})"}
        sha = self.git.commit_all(f"codewatch fix {n}: {item.signal} in {item.path}")
        check, after = self._validate(item, sha, before)
        if check.passed and item.kind == TEST_GAP:
            sha, check = self._admit(n, item, sha)
        review, resumed = None, False
        if check.passed:
            sha, check, after, review, resumed = self._review(n, item, sha, before, after)
        if not check.passed:
            self.git.revert(sha)
            self.feedback = f"Your change for item {n} was reverted ({check.name}: {check.detail})."
            cause = f"{check.name}: {check.detail}"
            return {"status": "reverted", "commit": sha, "reason": cause, "cause": cause,
                    "review": review, "resumed": resumed, **self._extra_fields()}
        return {**self._kept(item, sha, before, after, review, resumed), **self._extra_fields()}

    def _extra_fields(self) -> dict:
        return {**({"flaky": list(self.flaky)} if self.flaky else {}),
                **({"admission": self.gated} if self.gated else {})}

    def _admit(self, n: int, item: Item, sha: str) -> tuple[str, Check]:
        """The gate, then one retry with a fixed message when it rejects tests."""
        verdict = self._gate(sha)
        if verdict.error or not verdict.rejected:
            return sha, verdict.check()
        self._ask(retry_prompt(verdict.rejected))
        if not self.git.dirty():
            return sha, verdict.check()
        sha, check, _ = self._revise(n, item, sha, None)
        if check.passed and not (self.gated or {}).get("admitted"):
            return sha, Check("admission", False, "the retry left no new test to admit")
        return sha, check

    def _revise(self, n: int, item: Item, sha: str, before: Snapshot | None):
        """Amends the commit with the session's edits, validates it, and gates a test gap again.

        A revision that undoes the whole commit is not amended (git refuses an empty amend):
        its edits are discarded and the check fails, so the caller reverts the commit.
        """
        if self.git.amend_would_empty():
            self.git.discard_edits()
            return sha, Check("revision", False, "the session undid the whole commit; nothing left to keep"), None
        sha = self.git.commit_all(f"codewatch fix {n}: {item.signal} in {item.path}", amend=True)
        check, after = self._validate(item, sha, before)
        if check.passed and item.kind == TEST_GAP:
            check = self._gate(sha).check()
        return sha, check, after

    def _gate(self, sha: str) -> Verdict:
        """Runs the gate; `rejected` keeps a test rejected on the first attempt unless the retry admits it."""
        assert self.admission is not None
        verdict = self.admission(sha, self.clock.remaining())
        earlier = set((self.gated or {}).get("rejected", [])) - set(verdict.admitted)
        self.gated = {"admitted": list(verdict.admitted), "rejected": sorted(earlier | set(verdict.rejected))}
        return verdict

    def _review(self, n: int, item: Item, sha: str, before: Snapshot | None, after: Snapshot | None):
        review = self._call_reviewer(sha)
        if review["verdict"] != "conflict":
            return sha, Check("review", True, review["verdict"]), after, review, False
        self._ask(conflict_prompt(review.get("reason") or "", review.get("spec_line")))
        if self.git.dirty():
            sha, check, after = self._revise(n, item, sha, before)
            if not check.passed:
                return sha, check, after, review, True
            review = self._call_reviewer(sha)
        passed = review["verdict"] != "conflict"
        detail = review["verdict"] if passed else f"conflict after one resume: {review.get('reason')}"
        return sha, Check("review", passed, detail), after, review, True

    def _call_reviewer(self, sha: str) -> dict:
        review = self.reviewer(sha, self.clock.remaining())
        self.review_tokens += int(review.get("tokens") or 0)
        self.review_usd += float(review.get("usd") or 0.0)
        return review

    def _ask(self, prompt: str):
        call = self.session.ask(prompt, self.clock.call_timeout())
        if call.timed_out:
            raise TimeLimitReached("the session reached the time limit")
        return call

    def _validate(self, item: Item, sha: str, before: Snapshot | None) -> tuple[Check, Snapshot | None]:
        tests_only = item.kind == TEST_GAP
        if tests_only:
            outside = sorted(p for p in self.git.files_in(sha) if not p.startswith(f"{self.tests_dir}/"))
            if outside:
                return Check("scope", False, f"a test gap changed files outside {self.tests_dir}/: {', '.join(outside)}"), None
        tests = self.tests(self.env, self.clock.remaining())
        self.flaky = tests.flaky
        if not tests.passed or tests_only:
            return tests, None
        after = self.graph.snapshot(self.fix_ref, self.clock.remaining())
        return ratchet_check(before, after), after

    def _kept(self, item: Item, sha: str, before: Snapshot | None, after: Snapshot | None,
              review: dict | None, resumed: bool) -> dict:
        added: list[dict] = []
        if item.kind == TEST_GAP:
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
