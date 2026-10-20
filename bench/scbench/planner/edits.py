"""AST machinery the recipes share: where a statement run can be cut out, the stage that replaces it, and
locating a def or statement again in a deep copy of the module (copies keep line and column numbers).

A run of statements is extractable when it has no yield, await, global, nonlocal, nested def or class,
no break or continue that leaves it, and either no return or a return on every path (then the call
site returns the stage's value). The stage takes the cut's `in` names plus any `out` name the run may
leave unbound, and returns its `out` names.
"""

from __future__ import annotations

import ast
import copy

from planner.cutwidth import cut_width
from planner.units import dilution, own_cc

BLOCKERS = (ast.Yield, ast.YieldFrom, ast.Await, ast.Global, ast.Nonlocal, ast.FunctionDef, ast.AsyncFunctionDef,
            ast.ClassDef)
LOOPS = (ast.For, ast.AsyncFor, ast.While)


def stmts_cc(stmts: list[ast.stmt]) -> int:
    return own_cc(ast.Module(body=stmts, type_ignores=[])) - 1


def terminates(stmts: list[ast.stmt]) -> bool:
    if not stmts:
        return False
    last = stmts[-1]
    if isinstance(last, (ast.Return, ast.Raise)):
        return True
    if isinstance(last, ast.If):
        return terminates(last.body) and terminates(last.orelse)
    if isinstance(last, (ast.With, ast.AsyncWith)):
        return terminates(last.body)
    return False


def _escapes(node: ast.AST, in_loop: bool) -> bool:
    if isinstance(node, (ast.Break, ast.Continue)):
        return not in_loop
    if isinstance(node, ast.Lambda):
        return False
    inner = in_loop or isinstance(node, LOOPS)
    return any(_escapes(c, inner) for c in ast.iter_child_nodes(node))


def _definite(stmts: list[ast.stmt]) -> set[str]:
    """Names every path through the run binds (assignments, and both arms of an if/else)."""
    out = set()
    for st in stmts:
        if isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = st.targets if isinstance(st, ast.Assign) else [st.target]
            out |= {n.id for t in targets for n in ast.walk(t) if isinstance(n, ast.Name)}
        elif isinstance(st, ast.If) and st.orelse:
            out |= (_definite(st.body) if not terminates(st.body) else _definite(st.orelse)) & (
                _definite(st.orelse) if not terminates(st.orelse) else _definite(st.body))
    return out


def cut(fn: ast.AST, stmts: list[ast.stmt]) -> dict | None:
    """The stage shape of a statement run, or None when it cannot be cut out."""
    nodes = [n for st in stmts for n in ast.walk(st)]
    returns = any(isinstance(n, ast.Return) for n in nodes)
    if any(isinstance(n, BLOCKERS) for n in nodes) or any(_escapes(st, False) for st in stmts):
        return None
    if returns and not terminates(stmts):
        return None
    width = cut_width(fn, stmts[0].lineno, stmts[-1].end_lineno)
    outs = [] if returns else width["out"]
    params = sorted(set(width["in"]) | (set(outs) - _definite(stmts)))
    receiver = any(isinstance(n, ast.Name) and n.id in ("self", "cls") for n in nodes)
    return {"range": width["range"], "in": width["in"], "out": outs, "mutated": width["mutated"],
            "width": width["width"], "params": params, "returns": returns, "receiver": receiver,
            "cc": stmts_cc(stmts)}


def find_def(tree: ast.Module, qual: str) -> tuple[ast.AST, list[ast.stmt]]:
    """The def with this qualified name and the body list that holds it."""
    def walk(body, prefix):
        for node in body:
            name = prefix + node.name if isinstance(node, (ast.ClassDef, *dilution.FUNCTIONS)) else None
            if name == qual and isinstance(node, dilution.FUNCTIONS):
                return node, body
            if name:
                hit = walk(node.body, name + ".")
                if hit:
                    return hit
        return None
    return walk(tree.body, "")


def find_stmt(root: ast.AST, line: int, col: int) -> tuple[ast.stmt, list[ast.stmt]]:
    """The statement at (line, col) under root and the body list that holds it."""
    for node in ast.walk(root):
        for name in ("body", "orelse", "finalbody", "handlers"):
            body = getattr(node, name, None)
            if isinstance(body, list):
                for st in body:
                    if getattr(st, "lineno", None) == line and st.col_offset == col:
                        return st, body
    raise LookupError(f"no statement at {line}:{col}")


def unique_name(tree: ast.Module, base: str) -> str:
    taken = {n.name for n in ast.walk(tree) if isinstance(n, (ast.ClassDef, *dilution.FUNCTIONS))}
    taken |= {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    name, i = base, 2
    while name in taken:
        name, i = f"{base}{i}", i + 1
    return name


def stage_def(name: str, shape: dict, stmts: list[ast.stmt], method: bool) -> ast.FunctionDef:
    body = copy.deepcopy(stmts)
    if shape["out"]:
        names = [ast.Name(n, ast.Load()) for n in shape["out"]]
        body.append(ast.Return(names[0] if len(names) == 1 else ast.Tuple(names, ast.Load())))
    receiver = ["self"] if method and shape["receiver"] else []
    decorators = [ast.Name("staticmethod", ast.Load())] if method and not shape["receiver"] else []
    args = ast.arguments(posonlyargs=[], args=[ast.arg(a) for a in receiver + shape["params"]], kwonlyargs=[],
                         kw_defaults=[], defaults=[])
    extra = {"type_params": []} if "type_params" in ast.FunctionDef._fields else {}
    return ast.FunctionDef(name=name, args=args, body=body, decorator_list=decorators, returns=None, **extra)


def call_site(name: str, shape: dict, method: bool) -> list[ast.stmt]:
    func = ast.Attribute(ast.Name("self", ast.Load()), name, ast.Load()) if method else ast.Name(name, ast.Load())
    call = ast.Call(func, [ast.Name(p, ast.Load()) for p in shape["params"]], [])
    if shape["returns"]:
        return [ast.Return(call)]
    if not shape["out"]:
        return [ast.Expr(call)]
    targets = [ast.Name(n, ast.Store()) for n in shape["out"]]
    return [ast.Assign([targets[0] if len(targets) == 1 else ast.Tuple(targets, ast.Store())], call)]


def replace_run(body: list[ast.stmt], first: ast.stmt, count: int, new: list[ast.stmt]) -> None:
    i = next(i for i, st in enumerate(body) if st is first)
    body[i:i + count] = new


def insert_after(body: list[ast.stmt], anchor: ast.AST, defs: list[ast.stmt]) -> None:
    i = next(i for i, st in enumerate(body) if st is anchor)
    body[i + 1:i + 1] = defs
