"""Immediate dominators of a call graph from a virtual root (Cooper, Harvey and Kennedy's iteration).

The root reaches every unit nothing calls, then, in key order, any unit still unreached (a cycle with
no outside caller). Every list is walked in sorted key order, so the result does not depend on dict
or set order.
"""

from __future__ import annotations

ROOT = "<root>"


def _postorder(succ: dict[str, list[str]]) -> list[str]:
    order, seen, stack = [], {ROOT}, [(ROOT, iter(succ[ROOT]))]
    while stack:
        node, children = stack[-1]
        nxt = next((c for c in children if c not in seen), None)
        if nxt is None:
            order.append(node)
            stack.pop()
        else:
            seen.add(nxt)
            stack.append((nxt, iter(succ[nxt])))
    return order


def _reach(succ: dict[str, list[str]], start: str, seen: set[str]) -> None:
    stack = [start]
    while stack:
        node = stack.pop()
        if node not in seen:
            seen.add(node)
            stack.extend(succ[node])


def _graph(edges: dict[str, dict[str, str]]) -> tuple[dict[str, list[str]], dict[str, set[str]]]:
    succ = {k: sorted(v) for k, v in edges.items()}
    pred: dict[str, set[str]] = {k: set() for k in edges}
    for src, dsts in succ.items():
        for dst in dsts:
            pred[dst].add(src)
    succ[ROOT], seen = [], set()
    for key in sorted(k for k in edges if not pred[k]) + sorted(edges):
        if key not in seen:
            succ[ROOT].append(key)
            pred[key].add(ROOT)
            _reach(succ, key, seen)
    return succ, pred


def immediate_dominators(edges: dict[str, dict[str, str]]) -> dict[str, str]:
    succ, pred = _graph(edges)
    rpo = list(reversed(_postorder(succ)))
    index = {k: i for i, k in enumerate(rpo)}
    idom = {ROOT: ROOT}

    def meet(a: str, b: str) -> str:
        while a != b:
            while index[a] > index[b]:
                a = idom[a]
            while index[b] > index[a]:
                b = idom[b]
        return a

    changed = True
    while changed:
        changed = False
        for node in rpo[1:]:
            done = sorted((p for p in pred[node] if p in idom), key=index.__getitem__)
            new = done[0]
            for p in done[1:]:
                new = meet(p, new)
            if idom.get(node) != new:
                idom[node], changed = new, True
    del idom[ROOT]
    return idom
