"""Segment order for the splice (C-248 S6). A lane asserts every pair of its segments it puts out of base
order (a moved segment against those it jumped, an added one against all the rest). The merged module
honours each lane's assertions, in lane order; a lane whose assertions cannot coexist with the earlier
lanes' is a conflict.
"""

from __future__ import annotations

import heapq
from collections import Counter


def asserted(base_keys: list[str], lane_keys: list[str]) -> set[tuple[str, str]]:
    """The (before, after) pairs of the lane's segments that base does not already put in that order."""
    pos = {k: i for i, k in enumerate(base_keys)}
    return {(a, b) for i, a in enumerate(lane_keys) for b in lane_keys[i + 1:]
            if not (a in pos and b in pos and pos[a] < pos[b])}


def _sort(reference: list[str], edges: set[tuple[str, str]]) -> list[str] | None:
    """The keys in an order meeting every edge, closest to reference; None on a cycle."""
    rank = {k: i for i, k in enumerate(reference)}
    after, need = {k: [] for k in reference}, Counter(b for _, b in edges)
    for a, b in edges:
        after[a].append(b)
    ready = [rank[k] for k in reference if not need[k]]
    heapq.heapify(ready)
    out = []
    while ready:
        key = reference[heapq.heappop(ready)]
        out.append(key)
        for b in after[key]:
            need[b] -= 1
            if not need[b]:
                heapq.heappush(ready, rank[b])
    return out if len(out) == len(reference) else None


def ordered(reference: list[str], asserts: dict[str, set[tuple[str, str]]]) -> tuple[list[str], list[str]]:
    """(the keys in order, the lanes whose assertions form a cycle with earlier lanes')."""
    keys, edges, losers = set(reference), set(), []
    for lane, pairs in asserts.items():
        mine = {(a, b) for a, b in pairs if a in keys and b in keys}
        if _sort(reference, edges | mine) is None:
            losers.append(lane)
        else:
            edges |= mine
    return _sort(reference, edges) or reference, losers


def keeps_order(lane_keys: list[str], result_keys: list[str], own: set[tuple[str, str]],
                others: set[tuple[str, str]]) -> bool:
    """The result keeps the lane's shared segments in the lane's order, except a pair another lane put out
    of base order; a pair the lane itself put out of base order always holds."""
    rpos = {k: i for i, k in enumerate(result_keys)}
    mine = [k for k in lane_keys if k in rpos]
    return not any(rpos[a] > rpos[b] and ((a, b) in own or (b, a) not in others)
                   for i, a in enumerate(mine) for b in mine[i + 1:])
