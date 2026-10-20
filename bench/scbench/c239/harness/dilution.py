"""Dilution-proof complexity numbers, computed the way scb-check 0.1.3 computes them, with no scb-check.

Per function: cyclomatic complexity (CC) and source lines (SLOC) as scb-check counts them:
  CC     1 + if/elif, for, while, except, assert, ternary, each boolean operator, each comprehension
         and each comprehension `if`; nested functions count in their parent too.
  SLOC   lines a code token starts on, minus standalone string statements (docstrings).
  scope  scb-check's walk: module, class and function bodies (not defs under a module-level `if`).

Tree measures, which a split cannot dilute the way it dilutes erosion (high mass / total mass):
  mass   high-CC mass, the sum over CC > 10 of CC * sqrt(SLOC)
  count  functions with CC > 10;  max  the largest CC;  total  the sum of CC
Report-only lines: the deepest block nesting, and defensive checks per 100 SLOC (isinstance calls,
`is None` / `is not None` comparisons, try blocks).
"""

from __future__ import annotations

import ast
import io
import math
import tokenize
from dataclasses import dataclass
from pathlib import Path

HIGH_CC = 10
EXCLUDED_DIRS = {".git", ".venv", "venv", "env", ".env", "__pycache__", "build", "dist", "node_modules",
                 "site-packages", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".codewatch",
                 ".evaluation_tests", ".claude", ".opencode"}
TESTS_DIRS = ("tests",)
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
BRANCHES = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.Assert, ast.IfExp)
COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
BLOCKS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.Match,
          *([ast.TryStar] if hasattr(ast, "TryStar") else []))
IGNORED_TOKENS = {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT,
                  tokenize.ENDMARKER}


@dataclass(frozen=True)
class Function:
    key: str
    cc: int
    sloc: int
    nesting: int
    source: str

    @property
    def mass(self) -> float:
        return self.cc * math.sqrt(self.sloc) if self.cc > HIGH_CC else 0.0


@dataclass(frozen=True)
class Module:
    functions: tuple[Function, ...]
    sloc: int
    defensive: int


def source_files(root: Path) -> list[Path]:
    """scb-check's file walk over the tree with the `tests` dir left out, as the ex-tests erosion stages it."""
    out = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if path.is_symlink() or EXCLUDED_DIRS.intersection(rel.parts[:-1]) or rel.parts[0] in TESTS_DIRS:
            continue
        out.append(path)
    return out


def cyclomatic(node: ast.AST) -> int:
    n = 1
    for x in ast.walk(node):
        if isinstance(x, BRANCHES):
            n += 1
        elif isinstance(x, COMPREHENSIONS):
            n += 1 + sum(len(c.ifs) for c in x.generators)
        elif isinstance(x, ast.BoolOp):
            n += len(x.values) - 1
    return n


def _owns_lines(node: ast.expr, lines: list[str]) -> bool:
    start, end = lines[node.lineno - 1], lines[node.end_lineno - 1]
    return not start[:node.col_offset].strip() and not end[node.end_col_offset:].strip()


def sloc_lines(text: str, tree: ast.Module) -> set[int]:
    lines: set[int] = set()
    try:
        lines = {t.start[0] for t in tokenize.generate_tokens(io.StringIO(text).readline) if t.type not in IGNORED_TOKENS}
    except (tokenize.TokenError, IndentationError):
        pass
    text_lines = text.splitlines()
    for x in ast.walk(tree):
        if isinstance(x, ast.Expr) and isinstance(x.value, ast.Constant) and isinstance(x.value.value, str) \
                and _owns_lines(x.value, text_lines):
            lines.difference_update(range(x.lineno, x.end_lineno + 1))
    return lines


def _is_elif(node: ast.AST, parent: ast.AST) -> bool:
    return isinstance(node, ast.If) and isinstance(parent, ast.If) and parent.orelse == [node]


def nesting(node: ast.AST, depth: int = 0) -> int:
    """Deepest block nesting inside `node`; an elif sits at its `if`'s depth."""
    deepest = depth
    for child in ast.iter_child_nodes(node):
        if isinstance(child, FUNCTIONS + (ast.ClassDef, ast.Lambda)):
            continue
        step = isinstance(child, BLOCKS) and not _is_elif(child, node)
        deepest = max(deepest, nesting(child, depth + step))
    return deepest


def defensive_checks(tree: ast.Module) -> int:
    n = 0
    for x in ast.walk(tree):
        if isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id == "isinstance":
            n += 1
        elif isinstance(x, ast.Compare):
            n += sum(isinstance(op, (ast.Is, ast.IsNot)) and isinstance(c, ast.Constant) and c.value is None
                     for op, c in zip(x.ops, x.comparators))
        elif isinstance(x, (ast.Try, *([ast.TryStar] if hasattr(ast, "TryStar") else []))):
            n += 1
    return n


def _defs(body: list[ast.stmt], prefix: str):
    """Functions where scb-check finds them: directly in a module, class or function body."""
    for node in body:
        if isinstance(node, FUNCTIONS):
            yield prefix + node.name, node
            yield from _defs(node.body, f"{prefix}{node.name}.")
        elif isinstance(node, ast.ClassDef):
            yield from _defs(node.body, f"{prefix}{node.name}.")


def parse_module(text: str, rel: str) -> Module | None:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return None
    lines, src = sloc_lines(text, tree), text.splitlines()
    fns = tuple(Function(key=f"{rel}:{name}", cc=cyclomatic(node),
                         sloc=sum(1 for n in range(node.lineno, node.end_lineno + 1) if n in lines),
                         nesting=nesting(node), source="\n".join(src[node.lineno - 1:node.end_lineno]))
                for name, node in _defs(tree.body, ""))
    return Module(functions=fns, sloc=len(lines), defensive=defensive_checks(tree))


def scan(root: Path) -> list[Module]:
    modules = (parse_module(p.read_text(errors="replace"), p.relative_to(root).as_posix()) for p in source_files(root))
    return [m for m in modules if m]


def measures(fns: list[Function]) -> dict:
    """The four numbers, plus scb-check's erosion (high mass / all mass) for comparability only."""
    mass, all_mass = sum(f.mass for f in fns), sum(f.cc * math.sqrt(f.sloc) for f in fns)
    return {"mass": round(mass, 1), "count": sum(f.cc > HIGH_CC for f in fns),
            "max": max((f.cc for f in fns), default=0), "total": sum(f.cc for f in fns), "functions": len(fns),
            "erosion": mass / all_mass if all_mass else 0.0}


def touched(before: list[Function], after: list[Function]) -> set[str]:
    """Functions the change added, edited or removed (by module path and qualified name)."""
    b, a = {f.key: f.source for f in before}, {f.key: f.source for f in after}
    return {k for k in b.keys() | a.keys() if b.get(k) != a.get(k)}


def report_lines(modules: list[Module]) -> dict:
    sloc = sum(m.sloc for m in modules)
    return {"nesting_max": max((f.nesting for m in modules for f in m.functions), default=0),
            "defensive_per_100": round(100 * sum(m.defensive for m in modules) / max(sloc, 1), 2), "sloc": sloc}


def compare(before_root: Path, after_root: Path) -> dict:
    """Before and after numbers for the whole tree and for the functions the change touched."""
    mb, ma = scan(before_root), scan(after_root)
    fb, fa = [f for m in mb for f in m.functions], [f for m in ma for f in m.functions]
    keys = touched(fb, fa)
    return {"tree": [measures(fb), measures(fa)],
            "touched": [measures([f for f in fb if f.key in keys]), measures([f for f in fa if f.key in keys])],
            "touched_functions": sorted(keys), "lines": [report_lines(mb), report_lines(ma)]}
