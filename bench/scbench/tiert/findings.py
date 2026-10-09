"""Turns a tree's pytest functions into `findings.jsonl` rows, one per test and signal."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from .collect import Function, is_test_function, parse_module, python_files
from .helpers import MAX_DEPTH, Resolver
from .oracle import NONE, WEAK, assertion_lines, self_compare_lines

TOOL = "tier-t"
SIGNALS = ("symbol_assertion_free", "symbol_weak_oracle_only", "symbol_duplicate_assert", "symbol_self_compare")
SHOWN_ASSERTIONS = 3


def scan(root: Path) -> tuple[list[dict], int]:
    """The rows for every pytest function under `root`, and how many functions were checked."""
    modules = [m for rel in python_files(root) if (m := parse_module(root, rel)) is not None]
    resolver = Resolver(modules)
    tests = [fn for m in modules for fn in m.functions.values() if is_test_function(fn)]
    return [row for fn in tests for row in findings_for(fn, resolver)], len(tests)


def findings_for(fn: Function, resolver: Resolver) -> list[dict]:
    rows = []
    strength = resolver.strength(fn)
    if strength == NONE:
        rows.append(_row(fn, "symbol_assertion_free", 1, _assertion_free_evidence(fn)))
    elif strength == WEAK:
        rows.append(_row(fn, "symbol_weak_oracle_only", 1, _weak_evidence(fn)))
    repeats = _repeats(fn)
    if repeats:
        rows.append(_row(fn, "symbol_duplicate_assert", len(repeats), _shown(repeats)))
    self_compares = self_compare_lines(fn.node)
    if self_compares:
        lines = ", ".join(str(n) for n in self_compares)
        rows.append(_row(fn, "symbol_self_compare", len(self_compares), f"both sides are the same expression at line {lines}"))
    return rows


def _row(fn: Function, signal: str, value: int, evidence: str) -> dict:
    line = fn.node.lineno
    return {
        "id": f"{TOOL}:{signal}:{fn.path}:{line}",
        "tool": TOOL,
        "signal": signal,
        "path": fn.path,
        "lineStart": line,
        "lineEnd": fn.node.end_lineno,
        "symbol": fn.qualname,
        "value": value,
        "threshold": 0,
        "severity": "warning",
        "evidence": evidence,
    }


def _assertion_free_evidence(fn: Function) -> str:
    text = f"no assert, pytest.raises/warns or assert* call in the test or its helpers (depth {MAX_DEPTH})"
    return f"{text}; markers: {', '.join(fn.markers)}" if fn.markers else text


def _weak_evidence(fn: Function) -> str:
    shown = [f"line {line}: {text}" for text, line in assertion_lines(fn.node)]
    head = "every assertion checks only shape, type, not-None, truthiness or a value against itself"
    return f"{head}; {_shown(shown)}" if shown else f"{head}, in its helpers"


def _shown(items: list[str]) -> str:
    rest = len(items) - SHOWN_ASSERTIONS
    return "; ".join(items[:SHOWN_ASSERTIONS]) + (f"; and {rest} more" if rest > 0 else "")


def _repeats(fn: Function) -> list[str]:
    """`line <n> repeats line <m>: <text>` for each assertion identical to an earlier one."""
    first: dict[str, int] = {}
    repeats = []
    for text, line in assertion_lines(fn.node):
        if text in first:
            repeats.append(f"line {line} repeats line {first[text]}: {text}")
        else:
            first[text] = line
    return repeats


def count_by_signal(rows: list[dict]) -> dict[str, int]:
    counts = Counter(r["signal"] for r in rows)
    return {s: counts.get(s, 0) for s in SIGNALS}
