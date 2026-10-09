"""What a test checks: its oracles, how strong they are, and which helpers it reaches.

An oracle is an `assert` statement, a `pytest.raises` / `warns` / `deprecated_call` /
`fail` call (as a call or a `with` item), or a call whose name starts with `assert` or is
`expect`. A weak oracle checks only shape, type, not-None, truthiness, or a value against
itself.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator

NONE, WEAK, STRONG = 0, 1, 2

PYTEST_ORACLES = frozenset({"raises", "warns", "deprecated_call", "fail"})
BARE_PYTEST_ORACLES = frozenset({"raises", "warns"})
WEAK_ASSERT_CALLS = frozenset({"assertIsNotNone", "assertIsInstance"})
TRUTHY_ASSERT_CALLS = frozenset({"assertTrue", "assertFalse", "assert_"})
WEAK_PREDICATES = frozenset({"isinstance", "hasattr", "callable", "len", "type"})
SHAPE_ATTRS = frozenset({"shape", "ndim", "dtype"})


def call_name(call: ast.Call) -> str:
    func = call.func
    if isinstance(func, ast.Attribute):
        return func.attr
    return func.id if isinstance(func, ast.Name) else ""


def _is_pytest_oracle(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id in BARE_PYTEST_ORACLES
    is_pytest = isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id == "pytest"
    return is_pytest and func.attr in PYTEST_ORACLES


def is_assert_call(call: ast.Call) -> bool:
    name = call_name(call)
    return name.lstrip("_").startswith("assert") or name == "expect"


def is_oracle_call(call: ast.Call) -> bool:
    return is_assert_call(call) or _is_pytest_oracle(call)


def oracle_nodes(fn: ast.AST) -> Iterator[ast.Assert | ast.Call]:
    for node in ast.walk(fn):
        if isinstance(node, ast.Assert) or (isinstance(node, ast.Call) and is_oracle_call(node)):
            yield node


def strength_of(node: ast.Assert | ast.Call) -> int:
    if isinstance(node, ast.Assert):
        return WEAK if is_weak_test(node.test) else STRONG
    if _is_pytest_oracle(node):
        return STRONG
    name = call_name(node)
    if name in WEAK_ASSERT_CALLS or is_self_compare(node):
        return WEAK
    if name in TRUTHY_ASSERT_CALLS and node.args:
        return WEAK if is_weak_test(node.args[0]) else STRONG
    return STRONG


def is_weak_test(expr: ast.expr) -> bool:
    if isinstance(expr, ast.BoolOp):
        return all(is_weak_test(v) for v in expr.values)
    if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not):
        return is_weak_test(expr.operand)
    if isinstance(expr, ast.Compare):
        return _is_weak_compare(expr)
    if isinstance(expr, ast.Call):
        return call_name(expr) in WEAK_PREDICATES
    return isinstance(expr, ast.Name | ast.Attribute | ast.Constant)


def _is_weak_compare(expr: ast.Compare) -> bool:
    if is_self_compare(expr):
        return True
    operands = [expr.left, *expr.comparators]
    if len(operands) == 2 and _is_none(operands[1]) and isinstance(expr.ops[0], ast.IsNot | ast.NotEq):
        return True
    return any(_is_shape_like(o) for o in operands)


def _is_none(expr: ast.expr) -> bool:
    return isinstance(expr, ast.Constant) and expr.value is None


def _is_shape_like(expr: ast.expr) -> bool:
    if isinstance(expr, ast.Attribute):
        return expr.attr in SHAPE_ATTRS
    return isinstance(expr, ast.Call) and call_name(expr) in WEAK_PREDICATES


def is_self_compare(node: ast.AST) -> bool:
    """An equality check whose two sides are the same expression."""
    if isinstance(node, ast.Compare):
        same_op = len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq | ast.Is)
        return same_op and ast.dump(node.left) == ast.dump(node.comparators[0])
    if isinstance(node, ast.Call) and is_assert_call(node) and len(node.args) >= 2:
        name = call_name(node).lower()
        equality = "equal" in name or "close" in name
        return equality and ast.dump(node.args[0]) == ast.dump(node.args[1])
    return False


def assertion_lines(fn: ast.AST) -> list[tuple[str, int]]:
    """Each direct assertion's expression text and line, `pytest.raises`-style checks excluded."""
    found = []
    for node in oracle_nodes(fn):
        if isinstance(node, ast.Assert):
            found.append((ast.unparse(node.test), node.lineno))
        elif not _is_pytest_oracle(node):
            found.append((ast.unparse(node), node.lineno))
    return sorted(found, key=lambda pair: pair[1])


def self_compare_lines(fn: ast.AST) -> list[int]:
    lines = []
    for node in oracle_nodes(fn):
        target = node.test if isinstance(node, ast.Assert) else node
        parts = target.values if isinstance(target, ast.BoolOp) else [target]
        if any(is_self_compare(p) for p in parts):
            lines.append(node.lineno)
    return sorted(lines)
