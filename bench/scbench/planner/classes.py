"""Class-level detectors (C-248 B7.1), because graph.db stores only a file-level `lcom4_max`.

  fields       attributes a class sets in `__init__` or `__post_init__`, or binds in its class body
  temporary    attributes another method stores to `self` that are not fields
  lcom4        connected components of the class's methods (`__init__`, static and class methods left
               out), linked when they share a `self` name or one calls the other through `self`, as
               code-graph 0.9.0 `lcom4OfClass` does
  methods      the class's method count, for the class-size utility
Classes nest by qualified name (`Outer.Inner`), as units do.
"""

from __future__ import annotations

import ast

from planner.units import dilution, own_nodes

INITS = ("__init__", "__post_init__")


def classes(tree: ast.Module) -> dict[str, ast.ClassDef]:
    out = {}

    def walk(body, prefix):
        for node in body:
            if isinstance(node, ast.ClassDef):
                out[prefix + node.name] = node
                walk(node.body, f"{prefix}{node.name}.")
            elif isinstance(node, dilution.FUNCTIONS):
                walk(node.body, f"{prefix}{node.name}.")
    walk(tree.body, "")
    return out


def _methods(cls: ast.ClassDef) -> list[ast.AST]:
    return [m for m in cls.body if isinstance(m, dilution.FUNCTIONS)]


def _self_names(fn: ast.AST, ctx=None) -> set[str]:
    return {x.attr for x in own_nodes(fn) if isinstance(x, ast.Attribute) and isinstance(x.value, ast.Name)
            and x.value.id == "self" and (ctx is None or isinstance(x.ctx, ctx))}


def _fields(cls: ast.ClassDef) -> set[str]:
    out = set()
    for node in cls.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            out |= {t.id for t in targets if isinstance(t, ast.Name)}
        elif isinstance(node, dilution.FUNCTIONS) and node.name in INITS:
            out |= _self_names(node, ast.Store)
    return out


def init_fields(tree: ast.Module) -> dict[str, set[str]]:
    return {name: _fields(cls) for name, cls in classes(tree).items()}


def _plain(fn: ast.AST) -> bool:
    decorators = {d.id for d in fn.decorator_list if isinstance(d, ast.Name)}
    return fn.name not in INITS and not decorators & {"staticmethod", "classmethod"}


def lcom4(cls: ast.ClassDef) -> int:
    methods = [m for m in _methods(cls) if _plain(m)]
    names = {m.name: _self_names(m) for m in methods}
    parent = {m: m for m in names}

    def find(m):
        while parent[m] != m:
            m = parent[m]
        return m
    for a in sorted(names):
        for b in sorted(names):
            if a < b and (names[a] & names[b] or b in names[a] or a in names[b]):
                parent[find(b)] = find(a)
    return len({find(m) for m in names})


def class_facts(tree: ast.Module) -> dict[str, dict]:
    out = {}
    for name, cls in sorted(classes(tree).items()):
        fields = _fields(cls)
        temporary = set().union(*(_self_names(m, ast.Store) for m in _methods(cls) if m.name not in INITS)) - fields
        out[name] = {"lcom4": lcom4(cls), "temporary": sorted(temporary), "methods": len(_methods(cls))}
    return out
