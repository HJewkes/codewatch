"""Mechanism signals derived from the `fix` stage's items; pure, no file or git reads.

Test kinds follow the design's categories (section 2.2). A `missing-test-kind` item names the
kind it adds in its `missing` evidence; weak-oracle items rewrite assertions to exact
values; an uncovered symbol gets a test of no particular kind.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from .inputs import FixItem, Stage

FIX_STAGE = "fix"
TEST_GAP = "test-gap"
KEPT, REVERTED = "kept", "reverted"
CONFLICT = "conflict"
GAMING_PHASES = (2, 3)
SPLIT_FLAGS = frozenset({"single-caller-helper", "pass-through"})
TEST_KINDS = ("snapshot_or_golden", "exact_output", "error_path", "other")
MISSING_KEYWORDS = (
    ("snapshot_or_golden", ("snapshot", "golden", "approval")),
    ("exact_output", ("exact",)),
    ("error_path", ("error",)),
)


def fix_items(stages: Iterable[Stage]) -> list[FixItem]:
    return [item for stage in stages if stage.name == FIX_STAGE for item in stage.items]


def test_gap_items_per_phase(items: Iterable[FixItem]) -> dict[int, int]:
    return dict(sorted(Counter(i.phase for i in items if i.kind == TEST_GAP).items()))


def kept_and_reverted(items: Iterable[FixItem]) -> tuple[int, int]:
    statuses = [i.status for i in items]
    return statuses.count(KEPT), statuses.count(REVERTED)


def review_counts(items: Iterable[FixItem]) -> dict[str, int]:
    """A resumed item had a first review conflict; `unresolved` ones still conflicted after it."""
    items = list(items)
    return {
        "conflicts": sum(i.resumed for i in items),
        "resumes_kept": sum(i.resumed and i.status == KEPT for i in items),
        "unresolved": sum(i.review_verdict == CONFLICT for i in items),
    }


def added_test_kind(item: FixItem) -> str:
    if item.signal == "missing-test-kind":
        text = (item.missing or "").lower()
        return next((kind for kind, words in MISSING_KEYWORDS if any(w in text for w in words)), "other")
    return "exact_output" if item.signal.startswith("symbol_") else "other"


def tests_added_by_kind(items: Iterable[FixItem]) -> dict[str, int]:
    """Kept test-gap commits, counted once each by the kind of test they add."""
    counts = Counter(added_test_kind(i) for i in items if i.kind == TEST_GAP and i.status == KEPT)
    return {kind: counts.get(kind, 0) for kind in TEST_KINDS}


def backlog_open(items: Iterable[FixItem], held_back: int) -> int:
    """Items that ended unfixed, plus quality items held back as provisional."""
    return sum(i.status != KEPT for i in items) + held_back


def split_commits(items: Iterable[FixItem]) -> list[int]:
    """Per kept phase-2 or phase-3 commit, the symbols it added that codewatch flags as a split."""
    return [
        sum(bool(SPLIT_FLAGS.intersection(s.flags)) for s in item.added_symbols)
        for item in items
        if item.status == KEPT and item.phase in GAMING_PHASES
    ]


def mechanism_counts(stages: list[Stage]) -> dict[str, int | dict]:
    items = fix_items(stages)
    kept, reverted = kept_and_reverted(items)
    held_back = sum(s.held_back for s in stages if s.name == FIX_STAGE)
    return {
        "test_gap_items_by_phase": test_gap_items_per_phase(items),
        "commits_kept": kept,
        "commits_reverted": reverted,
        **{f"review_{k}": v for k, v in review_counts(items).items()},
        "tests_added_by_kind": tests_added_by_kind(items),
        "backlog_open": backlog_open(items, held_back),
    }
