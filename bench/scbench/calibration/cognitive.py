"""Cognitive complexity as scb-check 0.1.3 computes it (analysis/symbols.py), mapped onto the Python AST.

scb-check walks the tree-sitter tree of a function_definition:
  +1                 each binary boolean operator (`a and b or c` is 2), and each `break` / `continue`
  +1 + nesting       each if, elif, else, for, while, except and ternary; its children sit one level deeper
Everything else, try and finally included, adds nothing and keeps the nesting. In tree-sitter the elif and
else clauses are children of their `if` (and an else of its loop), so they cost 1 + the `if`'s nesting + 1,
while a try's else keeps the try's nesting. Comprehensions, match, with and lambda add nothing. Nested defs,
classes, lambdas, default values, annotations and nested decorators count in the enclosing function.

own_body=True leaves out nested def and class bodies (they are their own units), as for own-body CC.
Lambdas are never units, so they stay in the own body.
"""

from __future__ import annotations

import ast

LOOPS = (ast.For, ast.AsyncFor, ast.While)
TRIES = (ast.Try, *([ast.TryStar] if hasattr(ast, "TryStar") else []))
NESTED_UNITS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


class _Counter:
    def __init__(self, own_body: bool) -> None:
        self.own_body = own_body

    def all(self, nodes: list | None, nesting: int) -> int:
        return sum(self.node(x, nesting) for x in nodes or ())

    def node(self, x: ast.AST, nesting: int) -> int:
        if isinstance(x, NESTED_UNITS) and self.own_body:
            return 0
        if isinstance(x, (ast.Break, ast.Continue)):
            return 1
        if isinstance(x, ast.If):
            return 1 + nesting + self._if_rest(x, nesting)
        if isinstance(x, LOOPS):
            inner = self.all(_fields(x, "orelse"), nesting + 1)
            return 1 + nesting + inner + self._else(x.orelse, nesting + 1)
        if isinstance(x, (ast.IfExp, ast.ExceptHandler)):
            return 1 + nesting + self.all(list(ast.iter_child_nodes(x)), nesting + 1)
        if isinstance(x, TRIES):
            rest = self.all(x.body + x.handlers + x.finalbody, nesting)
            return rest + self._else(x.orelse, nesting)
        own = len(x.values) - 1 if isinstance(x, ast.BoolOp) else 0
        return own + self.all(list(ast.iter_child_nodes(x)), nesting)

    def _if_rest(self, x: ast.If, nesting: int) -> int:
        """The `if`'s test and body, then its flat elif chain and else, as tree-sitter nests them."""
        total = self.all([x.test, *x.body], nesting + 1)
        while len(x.orelse) == 1 and _is_elif(x.orelse[0], x):
            x = x.orelse[0]
            total += 2 + nesting + self.all([x.test, *x.body], nesting + 2)
        return total + self._else(x.orelse, nesting + 1)

    def _else(self, stmts: list[ast.stmt], nesting: int) -> int:
        return 1 + nesting + self.all(stmts, nesting + 1) if stmts else 0


def _fields(x: ast.AST, *skip: str) -> list[ast.AST]:
    out: list[ast.AST] = []
    for name, value in ast.iter_fields(x):
        if name not in skip:
            out.extend(v for v in (value if isinstance(value, list) else [value]) if isinstance(v, ast.AST))
    return out


def _is_elif(node: ast.stmt, parent: ast.If) -> bool:
    """An `elif` starts at its `if`'s column; an `if` inside an `else:` block is indented past it."""
    return isinstance(node, ast.If) and node.col_offset == parent.col_offset and node.lineno > parent.lineno


def cognitive(fn: ast.FunctionDef | ast.AsyncFunctionDef, *, own_body: bool = False) -> int:
    """The function's cognitive complexity; its own decorators sit outside it, as in tree-sitter."""
    return _Counter(own_body).all(_fields(fn, "decorator_list"), 0)
