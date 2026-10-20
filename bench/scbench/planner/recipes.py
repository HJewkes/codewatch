"""Recipes R1-R3: candidate edits of a task's owned units, each an edit of a deep copy of the module so
the planner can score the task's real end state (rank.py). R4 is in inline.py. No recipe replaces code
with a library call (decision 497).

  R1  dispatch chain -> table: an if/elif ladder at the top of a body with at least r1_min_arms arms that
      each test one discriminant (a name or attribute path) against distinct literals (`==` or `in`).
      Every arm becomes a handler taking the union of the arms' cut `in` names, a table maps the
      literals to them, and the ladder becomes a lookup; the `else` arm stays where it was.
  R2  merge duplicated branches: two adjacent arms of one chain with identical bodies share one test.
  R3  stage extraction: each top-level compound statement, and each arm body of a top-level chain, of
      own-body CC at least r3_min_cc that can be cut out (edits.cut), with its cut range and width.
Methods get method stages (static when the run never reads `self`); a method whose first parameter is
not `self` gets no R1 or R3 candidate.
"""

from __future__ import annotations

import ast
import copy
import re
from dataclasses import dataclass, field
from typing import Callable

from planner import edits
from planner.calls import local_names
from planner.units import Unit, own_nodes

COMPOUND = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.Match)


@dataclass
class Candidate:
    id: str
    recipe: str
    unit: str
    touches: list[str]
    span: tuple[int, int]
    detail: dict
    apply: Callable[[ast.Module], None] = field(repr=False)

    def row(self) -> dict:
        return {"id": self.id, "recipe": self.recipe, "unit": self.unit, "span": list(self.span),
                "touches": self.touches, **self.detail}


def chain(node: ast.If) -> tuple[list[tuple[ast.expr, list[ast.stmt]]], list[ast.stmt]]:
    arms = []
    while True:
        arms.append((node.test, node.body))
        if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            node = node.orelse[0]
        else:
            return arms, node.orelse


def build_chain(arms: list[tuple[ast.expr, list[ast.stmt]]], orelse: list[ast.stmt]) -> ast.If:
    node = ast.If(arms[-1][0], arms[-1][1], orelse)
    for test, body in reversed(arms[:-1]):
        node = ast.If(test, body, [node])
    return node


def _method_ok(u: Unit) -> bool:
    args = u.node.args.posonlyargs + u.node.args.args
    return u.cls is None or bool(args) and args[0].arg == "self"


def _base(u: Unit) -> str:
    return u.node.name.strip("_") or "fn"


def _chains(fn: ast.AST) -> list[ast.If]:
    """Chain heads: Ifs that are not the lone `orelse` of another If."""
    inner = {id(n.orelse[0]) for n in own_nodes(fn) if isinstance(n, ast.If) and len(n.orelse) == 1
             and isinstance(n.orelse[0], ast.If)}
    return [n for n in own_nodes(fn) if isinstance(n, ast.If) and id(n) not in inner]


def _stage_apply(u: Unit, stmts: list[ast.stmt], shape: dict, suffix: str):
    first, count, method = (stmts[0].lineno, stmts[0].col_offset), len(stmts), u.cls is not None

    def apply(tree: ast.Module) -> None:
        fn, holder = edits.find_def(tree, u.qual)
        st, body = edits.find_stmt(fn, *first)
        name = edits.unique_name(tree, f"_{_base(u)}_{suffix}")
        edits.replace_run(body, st, count, edits.call_site(name, shape, method))
        edits.insert_after(holder, fn, [edits.stage_def(name, shape, stmts, method)])
    return apply


def r3(u: Unit, cfg: dict) -> list[Candidate]:
    runs = [[st] for st in u.node.body if isinstance(st, COMPOUND)]
    for head in (st for st in u.node.body if isinstance(st, ast.If)):
        arms, orelse = chain(head)
        runs += [body for test, body in arms if body[0].lineno > test.end_lineno]
        runs += [orelse] if orelse and not isinstance(orelse[0], ast.If) else []
    out = []
    for stmts in runs:
        shape = edits.cut(u.node, stmts)
        if shape and shape["cc"] >= cfg["recipes"]["r3_min_cc"] and _method_ok(u):
            span = (stmts[0].lineno, stmts[-1].end_lineno)
            detail = {k: shape[k] for k in ("in", "out", "mutated", "width", "params", "cc")}
            out.append(Candidate(f"R3:{u.key}:{span[0]}-{span[1]}", "R3", u.key, [u.key], span, detail,
                                 _stage_apply(u, stmts, shape, "stage")))
    return out


def _simple(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return True
    if isinstance(node, ast.Attribute):
        return _simple(node.value)
    return isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) and _simple(node.value)


def _keys(test: ast.expr) -> tuple[str, list, ast.expr] | None:
    """(discriminant dump, literal keys, discriminant) of `d == k`, `k == d` or `d in (k, ...)`."""
    if not (isinstance(test, ast.Compare) and len(test.ops) == 1):
        return None
    left, right, op = test.left, test.comparators[0], test.ops[0]
    if isinstance(op, ast.Eq):
        subject, key = (left, right) if isinstance(right, ast.Constant) else (right, left)
        keys = [key] if isinstance(key, ast.Constant) else None
    elif isinstance(op, ast.In) and isinstance(right, (ast.Tuple, ast.List, ast.Set)):
        subject, keys = left, right.elts if all(isinstance(e, ast.Constant) for e in right.elts) else None
    else:
        return None
    return (ast.dump(subject), [k.value for k in keys], subject) if keys and _simple(subject) else None


def _ident(value) -> str:
    text = re.sub(r"\W+", "_", str(value)).strip("_").lower()
    return text if text and not text[0].isdigit() else f"k{text}"


def _ladder(u: Unit, head: ast.If, cfg: dict) -> dict | None:
    arms, orelse = chain(head)
    keys = [_keys(test) for test, _ in arms]
    if len(arms) < cfg["recipes"]["r1_min_arms"] or None in keys or len({k[0] for k in keys}) != 1:
        return None
    values = [v for k in keys for v in k[1]]
    if len(set(values)) != len(values) or any(body[0].lineno <= test.end_lineno for test, body in arms):
        return None
    shapes = [edits.cut(u.node, body) for _, body in arms]
    if None in shapes or len({s["returns"] for s in shapes}) != 1 or any(s["out"] for s in shapes):
        return None
    params = sorted(set().union(*(s["params"] for s in shapes)))
    return {"arms": arms, "keys": [k[1] for k in keys], "subject": keys[0][2],
            "params": params, "returns": shapes[0]["returns"], "widths": [len(s["params"]) for s in shapes]}


def r1(u: Unit, cfg: dict) -> list[Candidate]:
    out = []
    for head in (st for st in u.node.body if isinstance(st, ast.If)):
        ladder = _ladder(u, head, cfg) if _method_ok(u) else None
        if ladder:
            span = (head.lineno, head.end_lineno)
            detail = {"arms": len(ladder["arms"]), "params": ladder["params"], "returns": ladder["returns"]}
            out.append(Candidate(f"R1:{u.key}:{span[0]}-{span[1]}", "R1", u.key, [u.key], span, detail,
                                 _table_apply(u, head, ladder)))
    return out


def _names(tree: ast.Module, bases: list[str]) -> list[str]:
    out: list[str] = []
    for base in bases:
        name, i = edits.unique_name(tree, base), 2
        while name in out:
            name, i = edits.unique_name(tree, f"{base}{i}"), i + 1
        out.append(name)
    return out


def _lookup(fn: ast.AST, table: str, ladder: dict, method: bool) -> tuple[str, ast.stmt, ast.Call]:
    taken = local_names(fn)
    local = next(n for n in ("handler", "_handler", "_dispatch_handler") if n not in taken)
    ref = ast.Attribute(ast.Name("self", ast.Load()), table, ast.Load()) if method else ast.Name(table, ast.Load())
    get = ast.Call(ast.Attribute(ref, "get", ast.Load()), [copy.deepcopy(ladder["subject"])], [])
    args = [ast.Name(a, ast.Load()) for a in (["self"] if method else []) + ladder["params"]]
    return local, ast.Assign([ast.Name(local, ast.Store())], get), ast.Call(ast.Name(local, ast.Load()), args, [])


def _table_apply(u: Unit, head: ast.If, ladder: dict):
    at, method = (head.lineno, head.col_offset), u.cls is not None
    shape = {"params": ladder["params"], "out": [], "returns": ladder["returns"], "receiver": method}

    def apply(tree: ast.Module) -> None:
        fn, holder = edits.find_def(tree, u.qual)
        st, body = edits.find_stmt(fn, *at)
        arms, orelse = chain(st)
        names = _names(tree, [f"_{_base(u)}_{_ident(ks[0])}" for ks in ladder["keys"]])
        defs = [edits.stage_def(n, shape, arm_body, method) for n, (_, arm_body) in zip(names, arms)]
        table = edits.unique_name(tree, f"_{_base(u).upper()}_HANDLERS")
        pairs = [(ast.Constant(v), ast.Name(n, ast.Load())) for n, ks in zip(names, ladder["keys"]) for v in ks]
        assign = ast.Assign([ast.Name(table, ast.Store())], ast.Dict([k for k, _ in pairs], [v for _, v in pairs]))
        local, lookup, call = _lookup(fn, table, ladder, method)
        found = ast.Compare(ast.Name(local, ast.Load()), [ast.IsNot()], [ast.Constant(None)])
        if ladder["returns"]:
            new = [lookup, ast.If(found, [ast.Return(call)], []), *orelse]
        else:
            new = [lookup, ast.If(found, [ast.Expr(call)], orelse)]
        edits.replace_run(body, st, 1, new)
        edits.insert_after(holder, fn, defs + [assign])
    return apply


def _merge_apply(u: Unit, first: ast.If):
    at = (first.lineno, first.col_offset)

    def apply(tree: ast.Module) -> None:
        fn, _ = edits.find_def(tree, u.qual)
        node, _ = edits.find_stmt(fn, *at)
        second = node.orelse[0]
        tests = [t for x in (node.test, second.test)
                 for t in (x.values if isinstance(x, ast.BoolOp) and isinstance(x.op, ast.Or) else [x])]
        node.test, node.orelse = ast.BoolOp(ast.Or(), tests), second.orelse
    return apply


def r2(u: Unit, cfg: dict) -> list[Candidate]:
    out = []
    for head in _chains(u.node):
        node = head
        while len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            nxt = node.orelse[0]
            same = ast.dump(ast.Module(node.body, [])) == ast.dump(ast.Module(nxt.body, []))
            if same:
                span = (node.lineno, nxt.body[-1].end_lineno)
                out.append(Candidate(f"R2:{u.key}:{span[0]}-{span[1]}", "R2", u.key, [u.key], span,
                                     {"arms": 2}, _merge_apply(u, node)))
            node = nxt
    return out
