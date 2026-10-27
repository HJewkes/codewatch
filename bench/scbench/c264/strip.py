"""C-264 S2: remove test functions and helpers from a test file by AST span.

A unit is a top-level `def` or `class` (`name`) or a method of a top-level class
(`Class::name`), keyed by pytest's node-id tail. A unit is removed only while its source
still equals the text recorded when the replay dropped it, so a test a later solve edited
survives and is counted. A test class left with no test method goes too.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field

from remediation.admission import test_names

Span = tuple[int, int]


@dataclass
class Outcome:
    text: str
    removed: list[str] = field(default_factory=list)
    edited: list[str] = field(default_factory=list)


def _span(node: ast.stmt) -> Span:
    first = min([node.lineno, *(d.lineno for d in getattr(node, "decorator_list", []))])
    return first, node.end_lineno or node.lineno


def spans(source: str) -> dict[str, Span]:
    """Line spans, decorators included, of the module's defs, classes and class methods."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {}
    found = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            found[node.name] = _span(node)
        if isinstance(node, ast.ClassDef):
            found |= {f"{node.name}::{m.name}": _span(m) for m in node.body
                      if isinstance(m, ast.FunctionDef | ast.AsyncFunctionDef)}
    return found


def unit_text(source: str, span: Span) -> str:
    return "\n".join(source.split("\n")[span[0] - 1:span[1]])


def units(source: str, tails: list[str]) -> dict[str, str]:
    """The current text of each named unit found in `source`."""
    found = spans(source)
    return {tail: unit_text(source, found[tail]) for tail in tails if tail in found}


def _cut(source: str, cut: list[Span]) -> str:
    lines = source.split("\n")
    drop = set()
    for start, end in cut:
        drop |= set(range(start - 1, end))
        after = end
        while after < len(lines) and not lines[after].strip() and (start == 1 or not lines[start - 2].strip()):
            drop.add(after)
            after += 1
    return "\n".join(line for n, line in enumerate(lines) if n not in drop)


def _has_tests(names: set[str], cls: str) -> bool:
    return any(n.startswith(f"{cls}::") for n in names)


def _emptied_test_classes(before: str, after: str, touched: set[str]) -> list[Span]:
    had, has, found = test_names(before), test_names(after), spans(after)
    return [found[c] for c in sorted(touched) if c in found and _has_tests(had, c) and not _has_tests(has, c)]


def strip(source: str, recorded: dict[str, str]) -> Outcome:
    """Remove each recorded unit whose text is unchanged; methods are cut before their class."""
    found, outcome = spans(source), Outcome(source)
    for tail in sorted(recorded, key=lambda t: -t.count("::")):
        if tail not in found:
            continue
        if unit_text(source, found[tail]) == recorded[tail]:
            outcome.removed.append(tail)
        else:
            outcome.edited.append(tail)
    whole = {t for t in outcome.removed if "::" not in t}
    cut = [found[t] for t in outcome.removed if t.split("::")[0] not in whole or "::" not in t]
    text = _cut(source, cut) if cut else source
    touched = {t.split("::")[0] for t in outcome.removed if "::" in t} - whole
    empty = _emptied_test_classes(source, text, touched)
    outcome.text = _cut(text, empty) if empty else text
    return outcome


def added_units(before: str | None, after: str) -> list[str]:
    """The top-level defs and classes, and class methods, `after` has and `before` lacks."""
    old = spans(before or "")
    return sorted(set(spans(after)) - set(old))
