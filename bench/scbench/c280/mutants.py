"""C-280 S4: a small AST mutator for the entry module, line-scoped, with seeded caps.

Operators (plan §1.4):
- `rel`: relational swap (`<`↔`<=`, `>`↔`>=`, `==`↔`!=`);
- `int`: integer constant ±1;
- `not`: a boolean-looking `return e` becomes `return not (e)`;
- `none`: `return x` becomes `return None`;
- `str`: a string constant becomes `""`;
- `raise`: a `raise` statement becomes `pass`;
- `guard`: an `if`/`elif` condition becomes `False`.

Every mutant rewrites a span on one source line and leaves all other lines byte-identical.
Sites that span several lines are skipped. At most `PER_LINE` mutants per reached line and
`PER_UNIT` per unit are drawn, with a `random.Random` seeded from the caller's seed.
"""

from __future__ import annotations

import ast
import random
from collections.abc import Iterable
from dataclasses import dataclass

PER_LINE = 3
PER_UNIT = 40
SWAPS = {"<": "<=", "<=": "<", ">": ">=", ">=": ">", "==": "!=", "!=": "=="}
BOOLISH = (ast.Compare, ast.BoolOp, ast.UnaryOp)


@dataclass(frozen=True, order=True)
class Mutant:
    line: int
    col: int
    end: int
    op: str
    replacement: str

    @property
    def key(self) -> str:
        return f"{self.line}:{self.col}:{self.op}:{self.replacement}"


def single_line(node: ast.AST) -> bool:
    return getattr(node, "end_lineno", None) == getattr(node, "lineno", 0)


def _span(node: ast.AST, op: str, replacement: str) -> Mutant:
    return Mutant(node.lineno, node.col_offset, node.end_col_offset, op, replacement)  # type: ignore[attr-defined]


OP_TOKENS = {ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">=", ast.Eq: "==", ast.NotEq: "!="}


def _relational(node: ast.Compare, lines: list[bytes]) -> Iterable[Mutant]:
    left = node.left
    for op, right in zip(node.ops, node.comparators, strict=True):
        token = OP_TOKENS.get(type(op))
        if token and left.end_lineno == right.lineno:
            gap = lines[right.lineno - 1][left.end_col_offset:right.col_offset]
            at = gap.find(token.encode())
            if at >= 0:
                start = left.end_col_offset + at
                yield Mutant(right.lineno, start, start + len(token), "rel", SWAPS[token])
        left = right


def _return(node: ast.Return) -> Iterable[Mutant]:
    value = node.value
    if value is None or not single_line(node):
        return
    text_none = not (isinstance(value, ast.Constant) and value.value is None)
    if text_none:
        yield _span(value, "none", "None")
    if isinstance(value, BOOLISH) or (isinstance(value, ast.Constant) and isinstance(value.value, bool)):
        yield Mutant(value.lineno, value.col_offset, value.end_col_offset, "not", "not ({})")


def _constant(node: ast.Constant, docstrings: set[int]) -> Iterable[Mutant]:
    value = node.value
    if not single_line(node) or isinstance(value, bool):
        return
    if isinstance(value, int):
        yield _span(node, "int", str(value + 1))
        yield _span(node, "int", str(value - 1))
    elif isinstance(value, str) and value and id(node) not in docstrings:
        yield _span(node, "str", '""')


def _docstrings(tree: ast.AST) -> set[int]:
    found: set[int] = set()
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef) and body:
            first = body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                found.add(id(first.value))
    return found


def _fstring_parts(tree: ast.AST) -> set[int]:
    return {id(part) for node in ast.walk(tree) if isinstance(node, ast.JoinedStr) for part in ast.walk(node)}


def sites(source: str) -> list[Mutant]:
    """Every mutant of `source`, sorted by position."""
    tree = ast.parse(source)
    lines = source.encode().split(b"\n")
    docstrings, inside_f = _docstrings(tree), _fstring_parts(tree)
    found: list[Mutant] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            found.extend(_relational(node, lines))
        elif isinstance(node, ast.Return):
            found.extend(_return(node))
        elif isinstance(node, ast.Constant) and id(node) not in inside_f:
            found.extend(_constant(node, docstrings))
        elif isinstance(node, ast.Raise) and single_line(node):
            found.append(_span(node, "raise", "pass"))
        elif isinstance(node, ast.If) and single_line(node.test):
            found.append(_span(node.test, "guard", "False"))
    return sorted(set(found))


def apply(source: str, mutant: Mutant) -> str:
    """`source` with only the mutant's span rewritten."""
    lines = source.split("\n")
    raw = lines[mutant.line - 1].encode()
    original = raw[mutant.col:mutant.end]
    replacement = mutant.replacement.replace("{}", original.decode())
    lines[mutant.line - 1] = (raw[:mutant.col] + replacement.encode() + raw[mutant.end:]).decode()
    return "\n".join(lines)


def sample(candidates: Iterable[Mutant], reached: set[int], seed: str,
           per_line: int = PER_LINE, cap: int = PER_UNIT) -> list[Mutant]:
    """At most `per_line` mutants per reached line and `cap` in all, reproducible from `seed`."""
    rng = random.Random(seed)
    by_line: dict[int, list[Mutant]] = {}
    for mutant in sorted(candidates):
        if mutant.line in reached:
            by_line.setdefault(mutant.line, []).append(mutant)
    drawn = [m for line in sorted(by_line)
             for m in rng.sample(by_line[line], min(per_line, len(by_line[line])))]
    return sorted(rng.sample(drawn, cap)) if len(drawn) > cap else drawn
