"""The oracle floor (C-280 S2): a new test with no real oracle is rejected whatever it reaches.

A test fails the floor when, across the test and the helpers it reaches (to `tiert.helpers.MAX_DEPTH`),
it has no oracle at all, or every oracle is one of:
- weak, as `tiert.oracle` defines it (not-None, type, shape, bare truthiness, a value against itself);
- a `Mock` assertion (`assert_called*`, `assert_has_calls`, `assert_any_call`, `assert_not_called`) or a
  comparison on `.call_count` / `.call_args`;
- `pytest.raises(Exception)` or `pytest.raises(BaseException)` without `match=`.

The check is syntactic and runs no pytest.
"""

from __future__ import annotations

import ast
from collections.abc import Iterable, Iterator, Sequence
from pathlib import Path

from tiert.collect import Function, parse_module, python_files
from tiert.helpers import MAX_DEPTH, Resolver
from tiert.oracle import STRONG, call_name, oracle_nodes, strength_of

MOCK_ASSERTS = frozenset({"assert_called", "assert_called_once", "assert_called_with",
                          "assert_called_once_with", "assert_has_calls", "assert_any_call",
                          "assert_not_called", "assert_awaited", "assert_awaited_once",
                          "assert_awaited_with", "assert_awaited_once_with", "assert_has_awaits",
                          "assert_any_await", "assert_not_awaited"})
MOCK_ATTRS = frozenset({"call_count", "call_args", "call_args_list", "mock_calls"})
BROAD = frozenset({"Exception", "BaseException"})

NO_ASSERTION = "has no assertion on the result"
WEAK_ASSERTION = "only checks type, shape, not-None or truthiness, never a value"
MOCK_ONLY = "only asserts that mocks were called, never what the code returned or changed"
MOCK_AND_BROAD = "only asserts that mocks were called or that some Exception was raised, never a value or a specific error"
BROAD_RAISE = "only expects a bare Exception, never a specific error type or message"

Oracle = ast.Assert | ast.Call


def floor(root: Path, node_ids: Sequence[str]) -> dict[str, str | None]:
    """Each node id mapped to the reason it fails the floor, or None when it passes. A node id
    the tree has no function for passes: the floor never rejects what it cannot read."""
    modules = [m for rel in python_files(root) if (m := parse_module(root, rel)) is not None]
    resolver = Resolver(modules)
    by_path = {m.path: m for m in modules}
    result: dict[str, str | None] = {}
    for node_id in node_ids:
        fn = _find(by_path, node_id)
        result[node_id] = None if fn is None else _reason(list(_oracles(fn, resolver)))
    return result


def _find(by_path: dict, node_id: str) -> Function | None:
    path, _, tail = node_id.partition("::")
    module = by_path.get(path)
    qualname = tail.split("[", 1)[0].replace("::", ".")
    return module.functions.get(qualname) if module else None


def _oracles(fn: Function, resolver: Resolver) -> Iterator[Oracle]:
    seen: set[tuple[str, str]] = set()
    frontier: list[Function] = [fn]
    for _ in range(MAX_DEPTH + 1):
        following: list[Function] = []
        for current in frontier:
            if (current.path, current.qualname) in seen:
                continue
            seen.add((current.path, current.qualname))
            yield from oracle_nodes(current.node)
            calls = (n for n in ast.walk(current.node) if isinstance(n, ast.Call))
            following += [h for c in calls if (h := resolver.resolve(c, current)) is not None]
        frontier = following


def _reason(oracles: Iterable[Oracle]) -> str | None:
    kinds = [_kind(o) for o in oracles]
    if not kinds:
        return NO_ASSERTION
    if "real" in kinds:
        return None
    if set(kinds) == {"mock", "broad"}:
        return MOCK_AND_BROAD
    for kind, reason in (("mock", MOCK_ONLY), ("broad", BROAD_RAISE)):
        if set(kinds) <= {kind}:
            return reason
    return WEAK_ASSERTION


def _kind(node: Oracle) -> str:
    if _is_mock(node):
        return "mock"
    if _is_broad_raise(node):
        return "broad"
    return "real" if strength_of(node) == STRONG else "weak"


def _is_mock(node: Oracle) -> bool:
    if isinstance(node, ast.Call):
        return call_name(node) in MOCK_ASSERTS or _mentions_mock_attr(node.args)
    return _mentions_mock_attr([node.test])


def _mentions_mock_attr(exprs: Iterable[ast.expr]) -> bool:
    return any(isinstance(n, ast.Attribute) and n.attr in MOCK_ATTRS for e in exprs for n in ast.walk(e))


def _is_broad_raise(node: Oracle) -> bool:
    if not (isinstance(node, ast.Call) and call_name(node) in {"raises", "assertRaises"} and node.args):
        return False
    first = node.args[0]
    named = first.elts if isinstance(first, ast.Tuple) else [first]
    broad = bool(named) and all(_type_name(n) in BROAD for n in named)
    return broad and not any(k.arg in {"match", "msg"} for k in node.keywords)


def _type_name(expr: ast.expr) -> str:
    return expr.attr if isinstance(expr, ast.Attribute) else getattr(expr, "id", "")
