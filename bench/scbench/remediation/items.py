"""Choose the remediation items: at most 8, confirmed, in the design's priority order.

Order (design section 1, step e): confirmed regressions, uncovered changed symbols,
weak oracles, then confirmed quality findings. Regressions and weak oracles come from
triage's `verdicts.jsonl`. Uncovered changed symbols are measured facts in
`findings.jsonl` (signal `diff-uncovered`) and get no triage question. When triage's
controls failed, quality and weak-oracle items are left out, and only regression and
coverage items go in.

The question texts repeat `packages/cli/src/commands/triage-questions.ts`, because
`verdicts.jsonl` stores the signal but not the question; a test keeps them in step.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

MAX_ITEMS = 8
SPEC_PATH = "<spec>"

REGRESSION = "regression"
COVERAGE = "coverage"
WEAK_ORACLE = "weak-oracle"
QUALITY = "quality"
KIND_ORDER = (REGRESSION, COVERAGE, WEAK_ORACLE, QUALITY)
TRUSTED_WHEN_PROVISIONAL = (REGRESSION, COVERAGE)

WEAK_ORACLE_SIGNALS = frozenset(
    {"symbol_weak_oracle_only", "symbol_assertion_free", "symbol_duplicate_assert", "symbol_self_compare"}
)
UNCOVERED_SIGNAL = "diff-uncovered"

QUESTIONS = {
    "regnet-diff": "Does the spec require this change in the program's recorded output?",
    UNCOVERED_SIGNAL: "Does any test exercise this symbol, changed in this checkpoint?",
    "symbol_weak_oracle_only": "Would this test still pass if the behaviour it names were wrong?",
    "symbol-single-caller-helper": "Is this helper, called from exactly one place, justified as a separate function?",
    "symbol-cognitive": "Is this function's complexity avoidable?",
    "symbol-narrating-comments": "Do these comments only restate what the next line of code does?",
    "symbol-comment-ratio": "Does this comment carry information the code does not?",
    "symbol-constant-params": "Is this parameter, passed the same value by every caller, unnecessary?",
    "symbol-pass-through": "Does this function add nothing beyond forwarding its arguments?",
    "ERA001": "Is this commented-out code dead and safe to delete?",
    "pyright/reportUnnecessaryCast": "Is this check redundant given the types the code already guarantees?",
    "file-swallowed-except": "Does this except block hide failures a caller should see?",
    "file-except-density": "Is this file's exception handling heavier than its failure modes need?",
    "clone": "Should these duplicated lines and their other copy share one implementation?",
}
QUESTIONS.update({s: QUESTIONS["symbol_weak_oracle_only"] for s in WEAK_ORACLE_SIGNALS})
QUESTIONS["pyright/reportUnnecessaryIsInstance"] = QUESTIONS["pyright/reportUnnecessaryCast"]
QUESTIONS["SIM105"] = QUESTIONS["file-swallowed-except"]

FIX_SKETCHES = {
    REGRESSION: "Restore the earlier output for this call; no spec line asks for the change.",
    COVERAGE: "Add a test under tests/ that calls this symbol and asserts its exact result.",
    WEAK_ORACLE: "Make the assertions pin the exact expected result, so a wrong result fails.",
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


def kind_of(signal: str) -> str:
    if signal == "regnet-diff":
        return REGRESSION
    if signal == UNCOVERED_SIGNAL:
        return COVERAGE
    return WEAK_ORACLE if signal in WEAK_ORACLE_SIGNALS else QUALITY


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


def _from_verdict(row: dict) -> Item | None:
    signal = row.get("signal", "")
    if row.get("verdict") != "confirmed" or signal not in QUESTIONS:
        return None
    kind = kind_of(signal)
    return Item(
        kind=kind, signal=signal, path=row.get("path", ""), symbol=row.get("symbol"),
        question=QUESTIONS[signal], verdict="confirmed", rationale=row.get("rationale", ""),
        citations=tuple(_citation(c) for c in row.get("citations", [])),
        fix=FIX_SKETCHES.get(kind if kind != QUALITY else signal, DEFAULT_QUALITY_SKETCH),
        provisional=row.get("controlRun") == "provisional",
    )


def _from_uncovered(row: dict) -> Item | None:
    if row.get("signal") != UNCOVERED_SIGNAL:
        return None
    start, end = row.get("lineStart"), row.get("lineEnd", row.get("lineStart"))
    return Item(
        kind=COVERAGE, signal=UNCOVERED_SIGNAL, path=row.get("path", ""), symbol=row.get("symbol"),
        question=QUESTIONS[UNCOVERED_SIGNAL], verdict="measured: no test covers it",
        rationale=row.get("evidence", ""), citations=(f"{row.get('path')}:{start}-{end}",),
        fix=FIX_SKETCHES[COVERAGE],
    )


def select_items(verdicts: list[dict], findings: list[dict], run_provisional: bool) -> tuple[list[Item], int]:
    """Returns the items to send, and how many confirmed items were left out as provisional."""
    candidates = [i for i in map(_from_verdict, verdicts) if i] + [i for i in map(_from_uncovered, findings) if i]
    trusted = [
        i for i in candidates
        if i.kind in TRUSTED_WHEN_PROVISIONAL or not (run_provisional or i.provisional)
    ]
    ordered = sorted(trusted, key=lambda i: KIND_ORDER.index(i.kind))
    return ordered[:MAX_ITEMS], len(candidates) - len(trusted)
