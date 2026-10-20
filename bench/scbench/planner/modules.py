"""Module instability and import cycles (C-248 B7.1), over calibration/imports.py's in-tree import graph.

  instability  I = Ce / (Ca + Ce); a module with no in-tree edges has I = 0
  cycle        a strongly connected component of more than one module
  SDP          a new edge into a module less stable than its source by more than the tolerance
               (I_dst - I_src > max_delta_i)
Edges and instability are compared before against after, so only what a change adds is charged.
"""

from __future__ import annotations

import ast

from calibration.imports import coupling, edges, module_name


def cycles(graph: set[tuple[str, str]]) -> list[list[str]]:
    """Strongly connected components with more than one module, each sorted, in sorted order."""
    nodes = sorted({n for e in graph for n in e})
    succ = {n: sorted(d for s, d in graph if s == n) for n in nodes}
    reach = {n: _reach(n, succ) for n in nodes}
    comps = {tuple(sorted(m for m in nodes if m in reach[n] and n in reach[m])) for n in nodes}
    return sorted(list(c) for c in comps if len(c) > 1)


def _reach(start: str, succ: dict[str, list[str]]) -> set[str]:
    seen, stack = {start}, [start]
    while stack:
        for d in succ[stack.pop()]:
            if d not in seen:
                seen.add(d)
                stack.append(d)
    return seen


def structure(trees: dict[str, ast.Module]) -> dict:
    graph = edges(trees)
    by_name = {module_name(rel): row["instability"] for rel, row in coupling(trees).items()}
    return {"edges": graph, "instability": by_name, "cycles": cycles(graph)}


def violations(before: dict, after: dict, max_delta_i: float) -> dict[str, list]:
    """New import cycles, and new edges that break SDP by more than max_delta_i."""
    new_cycles = [c for c in after["cycles"] if c not in before["cycles"]]
    inst = after["instability"]
    sdp = [[s, d, round(inst[d] - inst[s], 3)] for s, d in sorted(after["edges"] - before["edges"])
           if inst[d] - inst[s] > max_delta_i]
    return {"cycles": new_cycles, "sdp": sdp}
