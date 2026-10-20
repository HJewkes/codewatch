"""The call graph the planner clusters over: static name-based calls plus dispatch-table edges.

A call edge runs from a unit to the unit a call in its own body resolves to. Resolution, first hit wins:
  name()        a def nested in the caller or an enclosing def (class bodies are not enclosing scopes
                for a bare name), then a module-level def or class
                (a class resolves to its __init__), then the only def of that name in the tree
  self.m()      the method m of the caller's class (no inheritance)
  x.m()         the only def named m in the tree, when x is not a local of the caller
A dispatch edge runs from a unit to each function referenced as an element, key or value of a dict,
list, tuple or set literal in its own body, or in a module-level table it reads by name. Without them,
table-dispatched helpers look like roots. graph.db `calls` edges (`path#Qual` ids) merge in when given.
"""

from __future__ import annotations

import ast
import sqlite3
from collections import defaultdict

from planner.units import Unit, own_nodes

LITERALS = (ast.Dict, ast.List, ast.Tuple, ast.Set)


class Resolver:
    def __init__(self, units: list[Unit]):
        self.by_qual = {(u.mod, u.qual): u for u in units}
        self.by_name: dict[str, list[Unit]] = defaultdict(list)
        for u in units:
            self.by_name[u.qual.rsplit(".", 1)[-1]].append(u)

    def name(self, caller: Unit, name: str) -> Unit | None:
        scope = caller.qual
        while scope:
            hit = (caller.mod, scope) in self.by_qual and self.by_qual.get((caller.mod, f"{scope}.{name}"))
            if hit:
                return hit
            scope = scope.rpartition(".")[0]
        return (self.by_qual.get((caller.mod, name)) or self.by_qual.get((caller.mod, f"{name}.__init__"))
                or self.unique(name))

    def unique(self, name: str) -> Unit | None:
        hits = self.by_name.get(name, [])
        return hits[0] if len(hits) == 1 else None

    def attribute(self, caller: Unit, node: ast.Attribute, local_names: set[str]) -> Unit | None:
        if not isinstance(node.value, ast.Name):
            return None
        if node.value.id in ("self", "cls") and caller.cls:
            return self.by_qual.get((caller.mod, f"{caller.cls}.{node.attr}"))
        return None if node.value.id in local_names else self.unique(node.attr)

    def ref(self, caller: Unit, node: ast.AST, local_names: set[str]) -> Unit | None:
        if isinstance(node, ast.Name):
            return self.name(caller, node.id)
        if isinstance(node, ast.Attribute):
            return self.attribute(caller, node, local_names)
        return None


def local_names(fn: ast.AST) -> set[str]:
    a = fn.args
    names = {x.arg for x in a.posonlyargs + a.args + a.kwonlyargs} | {x.arg for x in (a.vararg, a.kwarg) if x}
    return names | {n.id for n in own_nodes(fn) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}


def literal_refs(literal: ast.AST):
    """Function-reference candidates directly inside a literal, its nested literals included."""
    parts = [*literal.keys, *literal.values] if isinstance(literal, ast.Dict) else literal.elts
    for part in parts:
        if isinstance(part, LITERALS):
            yield from literal_refs(part)
        elif isinstance(part, (ast.Name, ast.Attribute)):
            yield part


def module_tables(tree: ast.Module) -> dict[str, list[ast.AST]]:
    """Module-level `NAME = <literal>` assignments, by name, with their reference candidates."""
    tables = {}
    for stmt in tree.body:
        if isinstance(stmt, (ast.Assign, ast.AnnAssign)) and isinstance(stmt.value, LITERALS):
            for target in stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]:
                if isinstance(target, ast.Name):
                    tables[target.id] = list(literal_refs(stmt.value))
    return tables


def _unit_edges(u: Unit, resolver: Resolver, tables: dict[str, list[ast.AST]]):
    names = local_names(u.node)
    for x in own_nodes(u.node):
        if isinstance(x, ast.Call):
            yield "calls", resolver.ref(u, x.func, names)
        elif isinstance(x, LITERALS):
            yield from (("dispatch", resolver.ref(u, r, names)) for r in literal_refs(x))
        elif isinstance(x, ast.Name) and isinstance(x.ctx, ast.Load) and x.id in tables and x.id not in names:
            yield from (("dispatch", resolver.name(u, r.id)) for r in tables[x.id] if isinstance(r, ast.Name))


def call_edges(trees: dict[str, ast.Module], units: list[Unit]) -> dict[str, dict[str, str]]:
    """caller key -> {callee key: "calls" | "dispatch"}; a direct call wins over a dispatch reference."""
    resolver, tables = Resolver(units), {mod: module_tables(t) for mod, t in trees.items()}
    edges: dict[str, dict[str, str]] = {u.key: {} for u in units}
    for u in units:
        for kind, target in _unit_edges(u, resolver, tables[u.mod]):
            if target is not None and target.key != u.key and edges[u.key].get(target.key) != "calls":
                edges[u.key][target.key] = kind
    return edges


def merge_graph_db(edges: dict[str, dict[str, str]], db: str) -> None:
    """Add the latest snapshot's graph.db `calls` edges between known units."""
    con = sqlite3.connect(f"file:{db}?immutable=1", uri=True)
    rows = con.execute("select src_id, dst_id from edge where kind = 'calls' "
                       "and snapshot_id = (select max(id) from snapshot)").fetchall()
    con.close()
    for src, dst in rows:
        s, d = src.replace("#", ":", 1), dst.replace("#", ":", 1)
        if s in edges and d in edges and s != d:
            edges[s].setdefault(d, "calls")
