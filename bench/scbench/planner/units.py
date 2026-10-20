"""Function units of a Python tree, where scb-check finds them, with own-body measures.

  cc       own-body CC: dilution.py's counting rules over the body without nested defs and classes;
           lambda bodies count toward the enclosing function, so branches moved into a lambda stay counted
  cc_scb   dilution.py's CC (nested functions counted in their parent too), reported beside it
  sloc     own SLOC: dilution.py's code lines in the def, less those of nested defs and classes
  chars    characters on those own lines, the basis of the token estimate (chars / 3.5)
"""

from __future__ import annotations

import ast
import importlib.util
import sys
from dataclasses import dataclass, field
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent / "c239" / "harness"
NESTED_SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
HIGH_CC = 10
CHARS_PER_TOKEN = 3.5


def _load_dilution():
    if "dilution" in sys.modules:
        return sys.modules["dilution"]
    spec = importlib.util.spec_from_file_location("dilution", HARNESS / "dilution.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["dilution"] = module
    spec.loader.exec_module(module)
    return module


dilution = _load_dilution()


@dataclass
class Unit:
    key: str
    mod: str
    qual: str
    cls: str | None
    node: ast.AST = field(repr=False)
    cc: int
    cc_scb: int
    sloc: int
    chars: int
    params: int

    @property
    def hot(self) -> bool:
        return self.cc > HIGH_CC

    @property
    def tokens(self) -> int:
        return round(self.chars / CHARS_PER_TOKEN)


def own_nodes(fn: ast.AST):
    """Nodes of fn's own body: nested defs and classes are their own units, lambdas are not."""
    stack = list(ast.iter_child_nodes(fn))
    while stack:
        x = stack.pop()
        yield x
        if not isinstance(x, NESTED_SCOPES):
            stack.extend(ast.iter_child_nodes(x))


def own_cc(fn: ast.AST) -> int:
    n = 1
    for x in own_nodes(fn):
        if isinstance(x, dilution.BRANCHES):
            n += 1
        elif isinstance(x, dilution.COMPREHENSIONS):
            n += 1 + sum(len(c.ifs) for c in x.generators)
        elif isinstance(x, ast.BoolOp):
            n += len(x.values) - 1
    return n


def own_lines(fn: ast.AST) -> set[int]:
    nested: set[int] = set()
    for x in own_nodes(fn):
        if isinstance(x, NESTED_SCOPES):
            nested.update(range(x.lineno, x.end_lineno + 1))
    return set(range(fn.lineno, fn.end_lineno + 1)) - nested


def n_params(fn: ast.AST) -> int:
    a = fn.args
    names = [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs] + [x.arg for x in (a.vararg, a.kwarg) if x]
    return sum(n not in ("self", "cls") for n in names)


def _class_of(tree: ast.Module) -> dict[int, str]:
    """id(def) -> qualified name of the class it is a method of, for direct class members."""
    out: dict[int, str] = {}

    def walk(body, prefix):
        for node in body:
            if isinstance(node, ast.ClassDef):
                out.update({id(ch): prefix + node.name for ch in node.body if isinstance(ch, dilution.FUNCTIONS)})
                walk(node.body, f"{prefix}{node.name}.")
            elif isinstance(node, dilution.FUNCTIONS):
                walk(node.body, f"{prefix}{node.name}.")
    walk(tree.body, "")
    return out


def module_units(rel: str, text: str) -> tuple[ast.Module, list[Unit]] | None:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return None
    code, src, classes = dilution.sloc_lines(text, tree), text.splitlines(), _class_of(tree)
    units = []
    for qual, fn in dilution._defs(tree.body, ""):
        mine = own_lines(fn)
        units.append(Unit(key=f"{rel}:{qual}", mod=rel, qual=qual, cls=classes.get(id(fn)), node=fn,
                          cc=own_cc(fn), cc_scb=dilution.cyclomatic(fn), sloc=len(mine & code),
                          chars=sum(len(src[n - 1]) + 1 for n in sorted(mine & code)), params=n_params(fn)))
    return tree, units


def scan_tree(root: Path) -> tuple[dict[str, ast.Module], list[Unit]]:
    """Module trees and units of the tree's source files (dilution.py's walk, tests dir left out)."""
    trees, units = {}, []
    for path in dilution.source_files(root):
        rel = path.relative_to(root).as_posix()
        parsed = module_units(rel, path.read_text(errors="replace"))
        if parsed:
            trees[rel] = parsed[0]
            units.extend(parsed[1])
    return trees, units
