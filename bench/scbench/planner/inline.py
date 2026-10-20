"""Recipe R4: inline a trivial single-caller helper back into its caller.

A helper qualifies when the task owns it and its one caller, it is not the head, the whole tree calls it
from exactly one call site and names it in no dispatch table, it has no decorators, no `*args` or
`**kwargs`, and its body (a docstring aside) is one `return <expr>`. A method must be called as
`self.m(...)` from a method of its own class. The call becomes the expression with each parameter
replaced by its argument (or its literal default); a parameter used more than once needs a plain name or
literal argument, and the expression's other names must not be locals of the caller.
"""

from __future__ import annotations

import ast
import copy

from planner import edits
from planner.calls import local_names
from planner.recipes import Candidate
from planner.units import Unit, own_nodes


def _expr(u: Unit) -> ast.expr | None:
    body = [s for s in u.node.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]
    a = u.node.args
    plain = not (a.vararg or a.kwarg or a.posonlyargs or u.node.decorator_list)
    if plain and len(body) == 1 and isinstance(body[0], ast.Return) and body[0].value is not None:
        return body[0].value
    return None


def _sites(caller: Unit, helper: Unit) -> list[ast.Call]:
    name = helper.node.name
    out = []
    for node in own_nodes(caller.node):
        f = node.func if isinstance(node, ast.Call) else None
        if isinstance(f, ast.Name) and f.id == name and not helper.cls:
            out.append(node)
        elif isinstance(f, ast.Attribute) and f.attr == name:
            out.append(node)
    return out


def _bindings(helper: Unit, call: ast.Call) -> dict[str, ast.expr] | None:
    a = helper.node.args
    names = [x.arg for x in a.args][1 if helper.cls else 0:] + [x.arg for x in a.kwonlyargs]
    defaults = dict(zip([x.arg for x in a.args][len(a.args) - len(a.defaults):], a.defaults))
    defaults |= {x.arg: d for x, d in zip(a.kwonlyargs, a.kw_defaults) if d is not None}
    if any(isinstance(x, ast.Starred) for x in call.args) or any(k.arg is None for k in call.keywords):
        return None
    bound = dict(zip(names, call.args)) | {k.arg: k.value for k in call.keywords}
    for n in names:
        if n not in bound and isinstance(defaults.get(n), ast.Constant):
            bound[n] = defaults[n]
    return bound if set(bound) == set(names) and len(call.args) <= len(names) else None


def _safe(expr: ast.expr, bound: dict[str, ast.expr], caller: Unit) -> bool:
    uses = [n.id for n in ast.walk(expr) if isinstance(n, ast.Name)]
    plain = (ast.Name, ast.Constant)
    if any(uses.count(p) > 1 and not isinstance(v, plain) for p, v in bound.items()):
        return False
    free = set(uses) - set(bound) - {"self", "cls"}
    return not free & local_names(caller.node)


class _Substitute(ast.NodeTransformer):
    def __init__(self, bound: dict[str, ast.expr]):
        self.bound = bound

    def visit_Name(self, node: ast.Name) -> ast.AST:
        return copy.deepcopy(self.bound[node.id]) if node.id in self.bound else node


class _Replace(ast.NodeTransformer):
    def __init__(self, at: tuple[int, int], expr: ast.expr):
        self.at, self.expr = at, expr

    def visit_Call(self, node: ast.Call) -> ast.AST:
        if (node.lineno, node.col_offset) == self.at:
            return self.expr
        return self.generic_visit(node)


def _apply(caller: Unit, helper: Unit, call: ast.Call, expr: ast.expr):
    at = (call.lineno, call.col_offset)

    def apply(tree: ast.Module) -> None:
        fn, _ = edits.find_def(tree, caller.qual)
        _Replace(at, copy.deepcopy(expr)).visit(fn)
        h, holder = edits.find_def(tree, helper.qual)
        holder.remove(h)
    return apply


def _candidate(caller: Unit, helper: Unit, edges: dict[str, dict[str, str]]) -> Candidate | None:
    expr = _expr(helper)
    callers = [c for c, dsts in edges.items() if helper.key in dsts]
    if expr is None or callers != [caller.key] or edges[caller.key][helper.key] != "calls":
        return None
    sites = _sites(caller, helper)
    if len(sites) != 1 or (helper.cls and (helper.cls != caller.cls or not isinstance(sites[0].func, ast.Attribute))):
        return None
    bound = _bindings(helper, sites[0])
    if bound is None or not _safe(expr, bound, caller):
        return None
    inlined = _Substitute(bound).visit(copy.deepcopy(expr))
    span = (sites[0].lineno, sites[0].end_lineno)
    return Candidate(f"R4:{helper.key}", "R4", caller.key, sorted([caller.key, helper.key]), span,
                     {"helper": helper.key, "helper_sloc": helper.sloc}, _apply(caller, helper, sites[0], inlined))


def r4(owned: list[Unit], head: str, edges: dict[str, dict[str, str]]) -> list[Candidate]:
    by_key = {u.key: u for u in owned}
    out = []
    for helper in owned:
        callers = [c for c, dsts in edges.items() if helper.key in dsts and c in by_key]
        if helper.key != head and len(callers) == 1 and helper.mod == by_key[callers[0]].mod:
            hit = _candidate(by_key[callers[0]], helper, edges)
            out += [hit] if hit else []
    return out
