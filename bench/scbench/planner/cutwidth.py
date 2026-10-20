"""Cut width of a proposed cut range: the live variables an extracted stage would take in and give back.

Over the function's own body (nested defs skipped, lambdas included), for the statements whose lines
fall inside [start, end]:
  in        local names whose first use inside the range is a read (an upward-exposed read in textual
            order, where an assignment binds after its right-hand side is read)
  out       names the range binds whose next use after the range is a read, or whose first use in a
            loop around the range, before it, is a read (the other branch of an `if` the range sits
            in does not run after it)
  mutated   `in` names the range mutates in place (item or attribute stores, augmented item stores,
            and calls of list, dict and set mutators), which a stage also hands back
  width     |in| + |out ∪ mutated|
`self` and `cls` are the receiver, not cut variables; names not bound in the function are globals.
"""

from __future__ import annotations

import ast

from planner.calls import local_names
from planner.units import dilution, own_nodes

MUTATORS = {"append", "extend", "insert", "pop", "remove", "clear", "update", "add", "discard", "setdefault",
            "sort", "reverse", "popitem"}
RECEIVERS = {"self", "cls"}
LOOPS = (ast.For, ast.AsyncFor, ast.While)


def _parents(fn: ast.AST) -> dict[ast.AST, ast.AST]:
    out = {}
    for node in [fn, *own_nodes(fn)]:
        for child in ast.iter_child_nodes(node):
            out[child] = node
    return out


def _bind_position(name: ast.Name, parents: dict) -> tuple[int, int]:
    """Where a store takes effect: after the value it is bound from has been read."""
    node = parents.get(name)
    while isinstance(node, (ast.Tuple, ast.List, ast.Starred)):
        node = parents.get(node)
    if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)) and node.value is not None:
        return node.value.end_lineno, node.value.end_col_offset
    if isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
        return node.iter.end_lineno, node.iter.end_col_offset
    if isinstance(node, ast.withitem):
        return node.context_expr.end_lineno, node.context_expr.end_col_offset
    if isinstance(node, ast.NamedExpr):
        return node.value.end_lineno, node.value.end_col_offset
    return name.lineno, name.col_offset


def _comprehension_local(name: ast.Name, parents: dict) -> bool:
    """True for a name a surrounding comprehension binds: it does not leak into the function."""
    node = parents.get(name)
    while node is not None:
        if isinstance(node, dilution.COMPREHENSIONS) and any(
                isinstance(t, ast.Name) and t.id == name.id
                for g in node.generators for t in ast.walk(g.target)):
            return True
        node = parents.get(node)
    return False


def _events(fn: ast.AST, parents: dict):
    """(position, kind, name) for every read and bind of a plain name, AugAssign targets read first."""
    for node in own_nodes(fn):
        if not isinstance(node, ast.Name) or node.id in RECEIVERS or _comprehension_local(node, parents):
            continue
        if isinstance(node.ctx, ast.Load) or isinstance(parents.get(node), ast.AugAssign):
            yield (node.lineno, node.col_offset), "read", node.id
        if isinstance(node.ctx, ast.Store):
            yield _bind_position(node, parents), "bind", node.id


def _mutated(fn: ast.AST, inside) -> set[str]:
    out = set()
    for node in own_nodes(fn):
        if not inside(node):
            continue
        if isinstance(node, (ast.Subscript, ast.Attribute)) and isinstance(node.ctx, ast.Store) \
                and isinstance(node.value, ast.Name):
            out.add(node.value.id)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr in MUTATORS and isinstance(node.func.value, ast.Name):
            out.add(node.func.value.id)
    return out - RECEIVERS


def _loop_span(fn: ast.AST, start: int, end: int) -> tuple[int, int]:
    """Lines of the outermost loop around the range, or the range itself."""
    spans = [(n.lineno, n.end_lineno) for n in own_nodes(fn)
             if isinstance(n, LOOPS) and n.lineno < start and n.end_lineno >= end]
    return min(spans, default=(start, end))


def _lines(stmts: list[ast.stmt]) -> set[int]:
    return {n for st in stmts for n in range(st.lineno, st.end_lineno + 1)}


def _exclusive_lines(fn: ast.AST, start: int, end: int) -> set[int]:
    """Lines of the other branch of each `if` the range sits in one branch of: never run after it."""
    out: set[int] = set()
    for node in own_nodes(fn):
        if isinstance(node, ast.If) and node.orelse:
            body, orelse = _lines(node.body), _lines(node.orelse)
            if {start, end} <= body:
                out |= orelse
            elif {start, end} <= orelse:
                out |= body
    return out


def _exposed(events: list, names: set[str], where) -> set[str]:
    """Names whose first event on the lines `where` selects is a read, in textual order."""
    first: dict[str, str] = {}
    for (line, _), kind, name in events:
        if name in names and where(line):
            first.setdefault(name, kind)
    return {n for n, kind in first.items() if kind == "read"}


def cut_width(fn: ast.AST, start: int, end: int) -> dict:
    bound = local_names(fn) - RECEIVERS
    parents = _parents(fn)
    events = sorted(_events(fn, parents))
    live_in = _exposed(events, bound, lambda line: start <= line <= end)
    binds = {n for (line, _), kind, n in events if kind == "bind" and start <= line <= end}
    loop_start, _ = _loop_span(fn, start, end)
    skip = _exclusive_lines(fn, start, end)
    live_out = _exposed(events, binds, lambda line: line > end and line not in skip) | _exposed(events, binds,
                                                                            lambda line: loop_start <= line < start)
    mutated = _mutated(fn, lambda node: hasattr(node, "lineno") and start <= node.lineno <= end) & live_in
    return {"range": [start, end], "in": sorted(live_in), "out": sorted(live_out), "mutated": sorted(mutated),
            "width": len(live_in) + len(live_out | mutated)}
