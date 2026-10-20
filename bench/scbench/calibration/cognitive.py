"""Own-body cognitive complexity, the C-248 round 3 port (Sonar rules mapped onto the Python AST).

Provisional: it matches scb-check exactly in only 11 of 44 trees, so its curve is marked provisional.
Nested function and class bodies are left out, as for own-body CC.
"""

from __future__ import annotations

import ast

LOOPS = (ast.For, ast.AsyncFor, ast.While)
TRIES = (ast.Try, *([ast.TryStar] if hasattr(ast, "TryStar") else []))
SKIPPED = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def _boolop_runs(node: ast.AST) -> int:
    """+1 per run of like boolean operators."""
    n = 0
    for x in ast.walk(node):
        if isinstance(x, ast.BoolOp):
            n += 1 - sum(isinstance(v, ast.BoolOp) and type(v.op) is type(x.op) for v in x.values)
    return n


def _expr_cost(e: ast.AST | None, depth: int) -> int:
    if e is None:
        return 0
    return _boolop_runs(e) + sum(1 + depth for x in ast.walk(e) if isinstance(x, ast.IfExp))


class _Counter:
    def __init__(self) -> None:
        self.total = 0

    def block(self, stmts: list[ast.stmt], depth: int) -> None:
        for s in stmts:
            self.stmt(s, depth)

    def stmt(self, s: ast.stmt, depth: int, is_elif: bool = False) -> None:
        if isinstance(s, SKIPPED):
            return
        if isinstance(s, ast.If):
            self._if(s, depth, is_elif)
        elif isinstance(s, LOOPS):
            self._loop(s, depth)
        elif isinstance(s, TRIES):
            self._try(s, depth)
        elif isinstance(s, ast.Match):
            self.total += 1 + depth
            for case in s.cases:
                self.block(case.body, depth + 1)
        elif isinstance(s, (ast.With, ast.AsyncWith)):
            self.block(s.body, depth)
        else:
            self._simple(s, depth)

    def _if(self, s: ast.If, depth: int, is_elif: bool) -> None:
        self.total += (1 if is_elif else 1 + depth) + _expr_cost(s.test, depth)
        self.block(s.body, depth + 1)
        if len(s.orelse) == 1 and isinstance(s.orelse[0], ast.If):
            self.stmt(s.orelse[0], depth, is_elif=True)
        elif s.orelse:
            self.total += 1
            self.block(s.orelse, depth + 1)

    def _loop(self, s: ast.stmt, depth: int) -> None:
        self.total += 1 + depth + _expr_cost(getattr(s, "test", None), depth)
        self.block(s.body, depth + 1)
        if s.orelse:
            self.total += 1
            self.block(s.orelse, depth + 1)

    def _try(self, s: ast.stmt, depth: int) -> None:
        self.block(s.body, depth)
        for handler in s.handlers:
            self.total += 1 + depth
            self.block(handler.body, depth + 1)
        self.block(s.orelse, depth)
        self.block(s.finalbody, depth)

    def _simple(self, s: ast.stmt, depth: int) -> None:
        for e in ast.iter_child_nodes(s):
            if isinstance(e, ast.expr):
                self.total += _expr_cost(e, depth)
                self.total += sum(1 + depth + len(x.ifs) for x in ast.walk(e) if isinstance(x, ast.comprehension))


def cognitive(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> int:
    counter = _Counter()
    counter.block(fn.body, 0)
    return counter.total
