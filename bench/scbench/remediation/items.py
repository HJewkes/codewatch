"""Choose and order the fix items (design Revision 1, D148 and D150; U8 in section 2.1).

- Phase 1: test gaps on code this PR changed: `diff-uncovered` findings (measured, not
  triaged) and confirmed weak-oracle and `missing-test-kind` verdicts.
- Phase 2: confirmed quality findings on code this PR changed.
- Phase 3: confirmed findings anywhere else, test gaps first. Each goes on its own branch.

There is no item cap by default; `limit` is opt-in. When triage's controls failed, or a
verdict is itself provisional, quality items are held back.

The question texts repeat `packages/cli/src/commands/triage-questions.ts`, because
`verdicts.jsonl` stores the signal but not the question; a test keeps them in step.
"""

from __future__ import annotations

import json
from collections.abc import Collection
from dataclasses import dataclass, replace
from pathlib import Path

SPEC_PATH = "<spec>"

TEST_GAP = "test-gap"
QUALITY = "quality"

WEAK_ORACLE_SIGNALS = frozenset(
    {"symbol_weak_oracle_only", "symbol_assertion_free", "symbol_duplicate_assert", "symbol_self_compare"}
)
UNCOVERED_SIGNAL = "diff-uncovered"
MISSING_TEST_KIND = "missing-test-kind"
TEST_GAP_SIGNALS = WEAK_ORACLE_SIGNALS | {UNCOVERED_SIGNAL, MISSING_TEST_KIND}

WEAK_ORACLE_QUESTION = "Would this test still pass if the behaviour it names were wrong?"
SINGLE_CALLER = "Is this helper, called from exactly one place, justified as a separate function?"
DEFENSIVE = "Is this check redundant given the types the code already guarantees?"
SWALLOWED = "Does this except block hide failures a caller should see?"

QUESTIONS = {
    UNCOVERED_SIGNAL: "Does any test exercise this symbol, changed in this checkpoint?",
    MISSING_TEST_KIND: "Would a test of the missing kind catch a plausible change the current tests miss?",
    **{signal: WEAK_ORACLE_QUESTION for signal in WEAK_ORACLE_SIGNALS},
    "symbol-single-caller-helper": SINGLE_CALLER,
    "symbol-cognitive": "Is this function's complexity avoidable?",
    "symbol-narrating-comments": "Do these comments only restate what the next line of code does?",
    "symbol-comment-ratio": "Does this comment carry information the code does not?",
    "symbol-constant-params": "Is this parameter, passed the same value by every caller, unnecessary?",
    "symbol-pass-through": "Does this function add nothing beyond forwarding its arguments?",
    "ERA001": "Is this commented-out code dead and safe to delete?",
    "pyright/reportUnnecessaryCast": DEFENSIVE,
    "pyright/reportUnnecessaryIsInstance": DEFENSIVE,
    "file-swallowed-except": SWALLOWED,
    "SIM105": SWALLOWED,
    "file-except-density": "Is this file's exception handling heavier than its failure modes need?",
    "clone": "Should these duplicated lines and their other copy share one implementation?",
}

FIX_SKETCHES = {
    UNCOVERED_SIGNAL: "Add a test that calls this symbol and asserts its exact result.",
    MISSING_TEST_KIND: "Add a test of the missing kind that pins the current behaviour.",
    "weak-oracle": "Make the assertions pin the exact expected result, so a wrong result fails.",
    "symbol-single-caller-helper": "Inline the helper into its one caller.",
    "symbol-cognitive": "Split or simplify the function without changing its behaviour.",
    "symbol-narrating-comments": "Delete the comments that restate the code.",
    "symbol-comment-ratio": "Delete the comments that repeat the code.",
    "symbol-constant-params": "Replace the parameter with the value every caller passes.",
    "symbol-pass-through": "Call the forwarded function directly and remove the pass-through.",
    "ERA001": "Delete the commented-out code.",
    "clone": "Move the duplicated lines into one shared implementation used by both copies.",
}
DEFAULT_QUALITY_SKETCH = "Make the change the confirmed answer calls for, without changing behaviour."


@dataclass(frozen=True)
class Item:
    kind: str
    signal: str
    path: str
    symbol: str | None
    question: str
    verdict: str
    rationale: str
    citations: tuple[str, ...]
    fix: str
    provisional: bool = False
    phase: int = 0


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = (json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return [row for row in rows if isinstance(row, dict)]


def controls_failed(triage_json: Path) -> bool:
    if not triage_json.is_file():
        return False
    controls = json.loads(triage_json.read_text()).get("controls") or {}
    return controls.get("controlRun") == "provisional"


def _citation(c: dict) -> str:
    where = "the specification" if c.get("path") == SPEC_PATH else c.get("path", "?")
    return f"{where}:{c.get('lineStart')}-{c.get('lineEnd')}"


def _sketch(signal: str) -> str:
    key = "weak-oracle" if signal in WEAK_ORACLE_SIGNALS else signal
    return FIX_SKETCHES.get(key, DEFAULT_QUALITY_SKETCH)


def _from_verdict(row: dict) -> Item | None:
    signal = row.get("signal", "")
    if row.get("verdict") != "confirmed" or signal not in QUESTIONS or signal == UNCOVERED_SIGNAL:
        return None
    return Item(
        kind=TEST_GAP if signal in TEST_GAP_SIGNALS else QUALITY, signal=signal,
        path=row.get("path", ""), symbol=row.get("symbol"), question=QUESTIONS[signal],
        verdict="confirmed", rationale=row.get("rationale", ""),
        citations=tuple(_citation(c) for c in row.get("citations", [])), fix=_sketch(signal),
        provisional=row.get("controlRun") == "provisional",
    )


def _from_uncovered(row: dict) -> Item | None:
    if row.get("signal") != UNCOVERED_SIGNAL:
        return None
    start, end = row.get("lineStart"), row.get("lineEnd", row.get("lineStart"))
    return Item(
        kind=TEST_GAP, signal=UNCOVERED_SIGNAL, path=row.get("path", ""), symbol=row.get("symbol"),
        question=QUESTIONS[UNCOVERED_SIGNAL], verdict="measured: no test covers it",
        rationale=row.get("evidence", ""), citations=(f"{row.get('path')}:{start}-{end}",),
        fix=_sketch(UNCOVERED_SIGNAL),
    )


def phase_of(item: Item, changed: Collection[str]) -> int:
    if item.path not in changed:
        return 3
    return 1 if item.kind == TEST_GAP else 2


def select_items(verdicts: list[dict], findings: list[dict], changed: Collection[str],
                 run_provisional: bool, limit: int | None = None) -> tuple[list[Item], int]:
    """Returns the items in phase order, and how many quality items were held back as provisional."""
    candidates = [i for i in map(_from_verdict, verdicts) if i] + [i for i in map(_from_uncovered, findings) if i]
    trusted = [i for i in candidates if i.kind == TEST_GAP or not (run_provisional or i.provisional)]
    phased = [replace(i, phase=phase_of(i, changed)) for i in trusted]
    ordered = sorted(phased, key=lambda i: (i.phase, i.kind != TEST_GAP))
    return (ordered if limit is None else ordered[:limit]), len(candidates) - len(trusted)
