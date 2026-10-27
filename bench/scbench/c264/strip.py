"""C-264 S2: remove test functions and helpers from a test file by AST span.

A unit is a top-level `def` or `class` (`name`) or a method of a top-level class
(`Class::name`), keyed by pytest's node-id tail. A unit is removed only while its source
still equals the text recorded when the replay dropped it, so a test a later solve edited
survives and is counted. A test class left with no test method goes too. A helper or fixture
stays while any remaining test code names it, so a cut never stops the suite from loading.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field

from remediation.admission import test_names

Span = tuple[int, int]


@dataclass
class Outcome:
    text: str
    removed: list[str] = field(default_factory=list)
    edited: list[str] = field(default_factory=list)
    in_use: list[str] = field(default_factory=list)


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


def _emptied_classes(source: str, tails: list[str]) -> set[str]:
    """Test classes every one of whose test methods is among `tails`."""
    names = test_names(source)
    classes = {t.split("::")[0] for t in tails if "::" in t}
    owned = {c: {n for n in names if n.startswith(f"{c}::")} for c in classes}
    return {c for c, tests in owned.items() if tests and tests <= set(tails)}


def _remove(source: str, tails: list[str]) -> str:
    """Cut the units; a test class that would be left with no test method goes whole."""
    found = spans(source)
    tails = [t for t in tails if t in found]
    whole = {t for t in tails if "::" not in t} | _emptied_classes(source, tails)
    cut = [found[t] for t in sorted(whole)] + [found[t] for t in tails if "::" in t and t.split("::")[0] not in whole]
    return _cut(source, cut) if cut else source


def is_test_unit(tail: str) -> bool:
    return tail.rsplit("::", 1)[-1].startswith(("test", "Test"))


def _unused(text: str, helpers: list[str], elsewhere: str) -> list[str]:
    found, unused = spans(text), []
    for tail in helpers:
        rest = _cut(text, [found[tail]]) if tail in found else text
        if not re.search(rf"\b{re.escape(tail.rsplit('::', 1)[-1])}\b", rest + elsewhere):
            unused.append(tail)
    return unused


def strip(source: str, recorded: dict[str, str], elsewhere: str = "") -> Outcome:
    """Cut each recorded unit whose text is unchanged: tests first, then the helpers and
    fixtures nothing left in this file or in `elsewhere` still names, so the suite still loads."""
    found, outcome = spans(source), Outcome(source)
    for tail in sorted(t for t in recorded if t in found):
        same = unit_text(source, found[tail]) == recorded[tail]
        (outcome.removed if same else outcome.edited).append(tail)
    tests = [t for t in outcome.removed if is_test_unit(t)]
    helpers = [t for t in outcome.removed if not is_test_unit(t)]
    text = _remove(source, tests)
    while unused := _unused(text, helpers, elsewhere):
        text = _remove(text, unused)
        helpers = [t for t in helpers if t not in unused]
    outcome.removed = [t for t in outcome.removed if t not in helpers]
    outcome.in_use = helpers
    outcome.text = text
    return outcome


def added_units(before: str | None, after: str) -> list[str]:
    """The top-level defs and classes, and class methods, `after` has and `before` lacks."""
    old = spans(before or "")
    return sorted(set(spans(after)) - set(old))
