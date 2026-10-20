"""Per-project measures for the calibration corpus, one row per unit, class and module.

Units are functions where scb-check finds them (dilution.py's walk). Per unit:
  cc       own-body CC: dilution.py's counting rules over the body without nested defs and lambdas
  cc_scb   dilution.py's CC, nested functions counted in their parent too
  cog      own-body cognitive complexity: cognitive.py's scb-check rules without nested defs and classes
  cog_scb  cognitive.py's cognitive complexity, nested functions counted in their parent too, as scb-check
  sloc     own SLOC: dilution.py's code lines in the def, less those of nested defs and classes
  in       parameters, not counting self and cls
  control, control_origin, stamp, common   the planner's interface-coupling counts (interface.py)
Classes: methods (excluding __init__, static and class methods, as code-graph's LCOM4), SLOC, and the
planner's lcom4 and temp_fields.
Modules: SLOC, plus fan-in (Ca), fan-out (Ce) and instability Ce / (Ca + Ce) over in-tree imports, and
the size of the import cycle the module is in (cycle, 0 for none).
"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

from calibration.cognitive import cognitive
from calibration.imports import coupling
from calibration.interface import NO_FINDINGS, class_cohesion, module_cycles, unit_coupling
from calibration.production import production_files

HARNESS = Path(__file__).resolve().parent.parent / "c239" / "harness"
NESTED = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)


def _load_dilution():
    if "dilution" in sys.modules:
        return sys.modules["dilution"]
    spec = importlib.util.spec_from_file_location("dilution", HARNESS / "dilution.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["dilution"] = module
    spec.loader.exec_module(module)
    return module


dilution = _load_dilution()


def own_nodes(fn: ast.AST):
    stack = list(ast.iter_child_nodes(fn))
    while stack:
        x = stack.pop()
        yield x
        if not isinstance(x, NESTED):
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


def _span(node: ast.AST) -> set[int]:
    return set(range(node.lineno, node.end_lineno + 1))


def own_sloc(fn: ast.AST, lines: set[int]) -> int:
    nested = set()
    for x in own_nodes(fn):
        if isinstance(x, NESTED[:3]):
            nested |= _span(x)
    return len((_span(fn) - nested) & lines)


def n_params(fn: ast.AST) -> int:
    a = fn.args
    names = [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs] + [x.arg for x in (a.vararg, a.kwarg) if x]
    return sum(n not in ("self", "cls") for n in names)


def class_methods(node: ast.ClassDef) -> int:
    def plain(ch):
        return not any(isinstance(d, ast.Name) and d.id in ("staticmethod", "classmethod") for d in ch.decorator_list)
    return sum(isinstance(ch, dilution.FUNCTIONS) and ch.name != "__init__" and plain(ch) for ch in node.body)


def unit_row(rel: str, name: str, fn: ast.AST, lines: set[int], found: dict) -> dict:
    key = f"{rel}:{name}"
    return {"key": key, "cc": own_cc(fn), "cc_scb": dilution.cyclomatic(fn),
            "cog": cognitive(fn, own_body=True), "cog_scb": cognitive(fn), "sloc": own_sloc(fn, lines),
            "in": n_params(fn), **found.get(key, NO_FINDINGS)}


def classes_of(tree: ast.Module, rel: str, lines: set[int]) -> list[dict]:
    return [{"key": f"{rel}:{node.name}", "methods": class_methods(node), "sloc": len(_span(node) & lines),
             **class_cohesion(node)} for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]


def measure_module(rel: str, text: str) -> dict | None:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return None
    lines = dilution.sloc_lines(text, tree)
    found = unit_coupling(rel, text)
    units = [unit_row(rel, name, fn, lines, found) for name, fn in dilution._defs(tree.body, "")]
    return {"path": rel, "sloc": len(lines), "units": units, "classes": classes_of(tree, rel, lines), "tree": tree}


def measure_project(root: Path) -> dict:
    """Units, classes and modules of the production code under root, with in-tree import coupling."""
    modules = [m for m in (measure_module(rel, text) for rel, text in production_files(root)) if m]
    trees = {m["path"]: m.pop("tree") for m in modules}
    fan, cyc = coupling(trees), module_cycles(trees)
    units = [u for m in modules for u in m.pop("units")]
    classes = [c for m in modules for c in m.pop("classes")]
    for m in modules:
        m.update(fan[m["path"]], cycle=cyc[m["path"]])
    return {"units": units, "classes": classes, "modules": modules,
            "sloc": sum(m["sloc"] for m in modules), "files": len(modules)}
