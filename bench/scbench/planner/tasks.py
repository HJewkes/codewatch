"""Inner-first nested hot tasks over dominator-subtree clusters, cut at module lines (C-248 S3a).

  cluster  a unit's cluster parent is its immediate dominator when both sit in one module; otherwise
           (another module, or the virtual root) the unit heads its own cluster
  task     one per hot unit (own-body CC > 10): the head plus every unit whose nearest hot cluster
           ancestor is that head. A hot unit inside another hot unit's subtree is its own task.
  wave     1 for a task with no inner task; otherwise one more than its deepest inner task, so inner
           tasks run first and the outer task sees their heads as frozen
  shared   a non-head unit that members of 2 or more tasks call. No cluster task owns it, nor what its
           task reaches only through it; a change to it is wave-1 shared work (S3b)
  frozen   units the task's members call but do not own: inner heads, shared callees, and other
           unowned callees. Every head's signature is frozen too.
  cap      a task over the token cap is split into parts along its cluster subtrees, and reported so
           (a split task keeps one owner; its parts are for the runner to schedule)
"""

from __future__ import annotations

from collections import defaultdict

from planner.dominators import immediate_dominators
from planner.units import Unit

TOKEN_CAP = 8000


def cluster_parents(units: dict[str, Unit], edges: dict[str, dict[str, str]]) -> dict[str, str | None]:
    idom = immediate_dominators(edges)
    return {k: idom[k] if idom[k] in units and units[idom[k]].mod == units[k].mod else None for k in sorted(units)}


def _ancestors(key: str, parent: dict[str, str | None]):
    node = parent[key]
    while node is not None:
        yield node
        node = parent[node]


def task_owners(units: dict[str, Unit], parent: dict[str, str | None]) -> dict[str, str]:
    """unit key -> the head of the task that owns it; units under no hot unit are not owned."""
    owner = {}
    for key in sorted(units):
        head = key if units[key].hot else next((a for a in _ancestors(key, parent) if units[a].hot), None)
        if head is not None:
            owner[key] = head
    return owner


def _waves(heads: list[str], parent: dict[str, str | None], owner: dict[str, str]) -> dict[str, int]:
    outer = {h: owner.get(parent[h]) if parent[h] else None for h in heads}
    wave: dict[str, int] = {h: 1 for h in heads}
    for h in heads:
        depth, node = 1, outer[h]
        while node is not None:
            depth += 1
            wave[node] = max(wave[node], depth)
            node = outer[node]
    return wave


def _pack(head: str, keys: list[str], units: dict[str, Unit], parent: dict[str, str | None], cap: int) -> list:
    """Parts of head's subtree: the head, then each cluster child's subtree (split again when over the
    cap) in key order, packed greedily into parts of at most `cap` tokens. A single unit over the cap
    stays a part of its own."""
    def tokens(part):
        return sum(units[k].tokens for k in part)
    if tokens(keys) <= cap:
        return [keys]
    groups: dict[str, list[str]] = defaultdict(list)
    for m in keys:
        top = m
        while top != head and parent[top] != head:
            top = parent[top]
        if top != head:
            groups[top].append(m)
    parts = [[head]]
    for top in sorted(groups):
        for piece in _pack(top, groups[top], units, parent, cap):
            if tokens(parts[-1] + piece) > cap:
                parts.append([])
            parts[-1].extend(piece)
    return parts


def _split(keys: list[str], units: dict[str, Unit], parent: dict[str, str | None], cap: int) -> list[dict]:
    return [{"members": sorted(p), "tokens": sum(units[k].tokens for k in p)}
            for p in _pack(keys[0], keys, units, parent, cap)]


def _members(owner: dict[str, str]) -> dict[str, list[str]]:
    """head -> owned keys, the head first and the rest in key order."""
    members: dict[str, list[str]] = defaultdict(list)
    for key, head in sorted(owner.items()):
        members[head].append(key)
    return {h: sorted(keys, key=lambda k: (k != h, k)) for h, keys in sorted(members.items())}


def _callees(members: list[str], edges: dict[str, dict[str, str]]) -> set[str]:
    return {d for m in members for d in edges[m]}


def shared_callees(owner: dict[str, str], edges: dict[str, dict[str, str]]) -> set[str]:
    """Non-head units that members of 2 or more tasks call."""
    tasks_calling: dict[str, set[str]] = defaultdict(set)
    for head, keys in _members(owner).items():
        for callee in _callees(keys, edges):
            tasks_calling[callee].add(head)
    return {k for k, hs in tasks_calling.items() if len(hs) >= 2 and owner.get(k) != k}


def _unshare(owner: dict[str, str], parent: dict[str, str | None], shared: set[str]) -> dict[str, str]:
    """Drop shared callees from ownership, and units their task reaches only through one of them."""
    def through_shared(key):
        node = key
        while node != owner[key]:
            if node in shared:
                return True
            node = parent[node]
        return False
    return {k: h for k, h in owner.items() if not through_shared(k)}


def _frozen(own: set[str], callees: set[str], heads: set[str], shared: set[str]) -> list[dict]:
    def why(key):
        return "inner head" if key in heads else "shared" if key in shared else "unowned"
    return [{"key": k, "why": why(k)} for k in sorted(callees - own)]


def unit_row(u: Unit) -> dict:
    return {"key": u.key, "cc": u.cc, "cc_scb": u.cc_scb, "sloc": u.sloc, "params": u.params, "tokens": u.tokens}


def plan_tasks(units: dict[str, Unit], edges: dict[str, dict[str, str]], cap: int = TOKEN_CAP) -> dict:
    parent = cluster_parents(units, edges)
    nested = task_owners(units, parent)
    shared = shared_callees(nested, edges)
    members = _members(_unshare(nested, parent, shared))
    heads = sorted(members)
    wave = _waves(heads, parent, nested)
    tasks = [_task(h, members[h], units, parent, wave[h],
                   _frozen(set(members[h]), _callees(members[h], edges), set(heads), shared), cap) for h in heads]
    waves = [sorted(t["id"] for t in tasks if t["wave"] == w) for w in range(1, max(wave.values(), default=0) + 1)]
    return {"token_cap": cap, "tasks": tasks, "waves": waves, "shared_callees": sorted(shared)}


def _task(head: str, keys: list[str], units: dict[str, Unit], parent: dict[str, str | None], wave: int,
          frozen: list[dict], cap: int) -> dict:
    tokens = sum(units[k].tokens for k in keys)
    task = {"id": head, "module": units[head].mod, "wave": wave, "head": unit_row(units[head]),
            "owned": [unit_row(units[k]) for k in keys], "frozen": frozen, "head_signature": "frozen",
            "tokens": tokens, "over_cap": tokens > cap}
    if tokens > cap:
        task["split"] = _split(keys, units, parent, cap)
    return task


def ownership_conflicts(plan: dict) -> list[str]:
    """Units owned by two tasks of one wave; an empty list means ownership is disjoint per wave."""
    seen: dict[tuple[int, str], str] = {}
    out = []
    for t in plan["tasks"]:
        for row in t["owned"]:
            other = seen.setdefault((t["wave"], row["key"]), t["id"])
            if other != t["id"]:
                out.append(f"wave {t['wave']}: {row['key']} owned by {other} and {t['id']}")
    return out
