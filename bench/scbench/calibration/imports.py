"""In-tree import coupling per module: fan-in (Ca), fan-out (Ce) and instability I = Ce / (Ca + Ce).

The import graph follows the C-248 round 2 port: a module is named by its path (a package by its
`__init__.py`), a leading `src/` is dropped, relative imports resolve against the package, and an
import resolves to the longest in-tree module prefix. Modules with no in-tree edges get I = 0.
"""

from __future__ import annotations

import ast


def module_name(rel: str) -> str:
    parts = rel[:-3].split("/")
    if parts[0] == "src" and len(parts) > 1:
        parts = parts[1:]
    return ".".join(parts[:-1]) if parts[-1] == "__init__" else ".".join(parts)


def _base(node: ast.ImportFrom, package: str) -> str:
    if not node.level:
        return node.module or ""
    up = package.split(".") if package else []
    up = up[:len(up) - (node.level - 1)] if node.level > 1 else up
    return ".".join(up + ([node.module] if node.module else []))


def _targets(node: ast.AST, package: str, known: set[str]) -> list[str]:
    if isinstance(node, ast.Import):
        return [a.name for a in node.names]
    if isinstance(node, ast.ImportFrom):
        base = _base(node, package)
        return [f"{base}.{a.name}" if f"{base}.{a.name}" in known else base for a in node.names]
    return []


def _resolve(target: str, known: set[str]) -> str:
    while target and target not in known:
        target = target.rpartition(".")[0]
    return target


def edges(trees: dict[str, ast.Module]) -> set[tuple[str, str]]:
    names = {rel: module_name(rel) for rel in trees}
    known = set(names.values())
    out = set()
    for rel, tree in trees.items():
        me = names[rel]
        package = me if rel.endswith("__init__.py") else me.rpartition(".")[0]
        for node in ast.walk(tree):
            for target in _targets(node, package, known):
                dst = _resolve(target, known)
                if dst and dst != me:
                    out.add((me, dst))
    return out


def coupling(trees: dict[str, ast.Module]) -> dict[str, dict]:
    graph = edges(trees)
    ca, ce = {}, {}
    for src, dst in graph:
        ce[src] = ce.get(src, 0) + 1
        ca[dst] = ca.get(dst, 0) + 1
    out = {}
    for rel in trees:
        name = module_name(rel)
        a, e = ca.get(name, 0), ce.get(name, 0)
        out[rel] = {"fan_in": a, "fan_out": e, "instability": round(e / (a + e), 3) if a + e else 0.0}
    return out
