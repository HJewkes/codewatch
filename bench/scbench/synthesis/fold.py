"""Fold taste and verdict fragments into their heads (design unit U16): pure, no files and no git.

A PR never edits a head document; it writes `taste.d/<id>.md` and `verdicts.d/<id>.jsonl`.
The fold reads the head plus every fragment in id order (`cp-2` before `cp-10`, as the
SessionStart hook and `codewatch triage --verdicts-dir` read them) and returns the new
head and the fragments it absorbed. `fold_job` writes the result and makes the commit.

- Taste: an `{owner ...}` line is never edited or removed. An `{inferred ... fp:<key>}`
  line replaces an earlier inferred line with the same key, in that line's place; any
  other new line is appended unless the head already has it.
- Verdicts: the latest row per key wins, and a key whose anchor symbol is absent from
  the head snapshot is dropped. Rows keep the text they were written with.
- A malformed fragment is left in place, reported and not absorbed.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field

Fragment = tuple[str, str]  # (file name, text)
Anchors = Callable[[str], bool]

_TAGGED = re.compile(r"^- .+ \{(?:inferred \S+ fp:(?P<key>\S+)|owner(?: [^{}]*)?)\}$")
_FINDING_KEY = re.compile(r"^[^:]+:[^:]+:(?P<anchor>.+):[^:#]+#\d+$")


@dataclass(frozen=True)
class Folded:
    head: str
    absorbed: list[str] = field(default_factory=list)
    malformed: dict[str, str] = field(default_factory=dict)


def id_order(names: list[str]) -> list[str]:
    """`cp-2` before `cp-10`: digit runs compare as numbers."""
    return sorted(names, key=lambda n: [(0, int(p), "") if p.isdigit() else (1, 0, p)
                                        for p in re.split(r"(\d+)", n)])


def anchor_of(key: str) -> str | None:
    """The anchor of a `tool:signal:anchor:textHash#ordinal` finding key: a symbol id or a file path."""
    match = _FINDING_KEY.match(key)
    return match["anchor"] if match else None


def _lines(text: str) -> list[str]:
    return [line.rstrip() for line in text.splitlines() if line.strip()]


def _taste_problem(text: str) -> str | None:
    bad = [n for n, line in enumerate(text.splitlines(), 1) if line.strip() and not _TAGGED.match(line.rstrip())]
    return f"line {bad[0]} has no provenance tag" if bad else None


def _inferred_key(line: str) -> str | None:
    match = _TAGGED.match(line)
    return match["key"] if match else None


def _fold_taste_line(lines: list[str], line: str) -> None:
    key = _inferred_key(line)
    if key is not None:
        for i, existing in enumerate(lines):
            if _inferred_key(existing) == key:
                lines[i] = line
                return
    if line not in lines:
        lines.append(line)


def fold_taste(head: str, fragments: list[Fragment]) -> Folded:
    lines = _lines(head)
    absorbed, malformed = [], {}
    for name, text in _in_id_order(fragments):
        problem = _taste_problem(text)
        if problem:
            malformed[name] = problem
            continue
        for line in _lines(text):
            _fold_taste_line(lines, line)
        absorbed.append(name)
    return Folded("".join(f"{line}\n" for line in lines), absorbed, malformed)


def _verdict_row(line: str) -> dict | None:
    try:
        row = json.loads(line)
    except json.JSONDecodeError:
        return None
    fields = ("key", "verdict", "path")
    return row if isinstance(row, dict) and all(isinstance(row.get(f), str) for f in fields) else None


def _verdict_rows(text: str) -> tuple[list[tuple[dict, str]], str | None]:
    """Each row with its own text, or the first malformed line's problem."""
    rows = []
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        row = _verdict_row(line)
        if row is None:
            return [], f"line {n} is not a verdict row"
        rows.append((row, line.strip()))
    return rows, None


def fold_verdicts(head: str, fragments: list[Fragment], present: Anchors) -> Folded:
    """`present` says whether an anchor is in the head snapshot; a malformed head folds nothing."""
    head_rows, problem = _verdict_rows(head)
    if problem:
        return Folded(head, [], {name: f"head: {problem}" for name, _ in fragments})
    latest = {row["key"]: (row, line) for row, line in head_rows}
    absorbed, malformed = [], {}
    for name, text in _in_id_order(fragments):
        rows, problem = _verdict_rows(text)
        if problem:
            malformed[name] = problem
            continue
        latest.update((row["key"], (row, line)) for row, line in rows)
        absorbed.append(name)
    kept = sorted((r for r in latest.values() if _anchored(r[0]["key"], present)),
                  key=lambda r: (r[0]["path"], r[0]["key"]))
    return Folded("".join(f"{line}\n" for _, line in kept), absorbed, malformed)


def _anchored(key: str, present: Anchors) -> bool:
    anchor = anchor_of(key)
    return anchor is None or present(anchor)


def _in_id_order(fragments: list[Fragment]) -> list[Fragment]:
    texts = dict(fragments)
    return [(name, texts[name]) for name in id_order(list(texts))]
