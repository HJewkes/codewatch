"""Function-level splice (C-248 S6): merge the lanes of one wave into the wave's base tree.

A module is cut into segments: each module-level statement, and inside a module-level class its header
and each body statement. A def segment's key is its qualified name; any other statement's key is its
own text, so two lanes adding the same import agree. A segment carries the comments and blank lines
above it. Per lane, a segment is changed (beyond the blank lines around it), deleted or added (anchored after the nearest earlier segment
that is in the base). Two lanes conflict only when they make different changes to one segment or add
one key with different text; additions at one anchor go in lane order. A non-Python file changed by
two lanes differently is a conflict too.

The splice is then checked: the result parses, and every unit a lane changed has, in the result, the
AST it has in that lane's tree. A lane in conflict is left out and reported, never half-applied.
"""

from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path

from planner.units import module_units

SKIP = {".git", ".venv", "venv", ".codewatch", "__pycache__", ".pytest_cache", ".ruff_cache"}
START = "^start"


def tree_files(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*"))
            if p.is_file() and not SKIP.intersection(p.relative_to(root).parts)}


def changed_files(base: dict[str, bytes], head: dict[str, bytes]) -> list[str]:
    return sorted(k for k in base.keys() | head.keys() if base.get(k) != head.get(k))


def _key(node: ast.stmt, lines: list[str], prefix: str) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return prefix + node.name
    return prefix + "|" + "".join(lines[node.lineno - 1:node.end_lineno]).strip()


def _first(node: ast.stmt) -> int:
    return min([node.lineno] + [d.lineno for d in getattr(node, "decorator_list", [])])


def _loose(line: str) -> bool:
    return not line.strip() or line.strip().startswith("#")


def _cuts(tree: ast.Module, lines: list[str]) -> list[tuple[int, int, str]]:
    """(first line, last line, key) of each segment's code, in order."""
    out = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.body:
            last = _first(node.body[0]) - 1
            while last > node.lineno and _loose(lines[last - 1]):
                last -= 1
            out.append((_first(node), last, f"class {node.name}"))
            out += [(_first(n), n.end_lineno, _key(n, lines, node.name + ".")) for n in node.body]
        else:
            out.append((_first(node), node.end_lineno, _key(node, lines, "")))
    return out


def _start(cuts: list[tuple[int, int, str]], i: int, lines: list[str]) -> int:
    """The comments and blank lines above a segment's code are its own."""
    if i == 0:
        return 1
    start, floor = cuts[i][0], cuts[i - 1][1]
    while start - 1 > floor and _loose(lines[start - 2]):
        start -= 1
    return start


def segments(text: str) -> list[tuple[str, str]]:
    """[(key, text)]: the module cut into segments; joined, they give back the text exactly."""
    lines = text.splitlines(keepends=True)
    cuts = _cuts(ast.parse(text), lines)
    if not cuts:
        return [(START, text)]
    starts = [_start(cuts, i, lines) for i in range(len(cuts))]
    out, seen = [], Counter()
    for (_, _, key), start, end in zip(cuts, starts, starts[1:] + [len(lines) + 1]):
        seen[key] += 1
        out.append((key if seen[key] == 1 else f"{key}#{seen[key]}", "".join(lines[start - 1:end - 1])))
    return out


def lane_changes(base: list[tuple[str, str]], head: list[tuple[str, str]]) -> dict:
    """{changed: {key: text}, deleted: [key], added: [(anchor, key, text)]} for one module."""
    base_map, head_keys = dict(base), {k for k, _ in head}
    changed = {k: t for k, t in head if k in base_map and base_map[k].strip() != t.strip()}
    added, anchor = [], START
    for key, text in head:
        if key in base_map:
            anchor = key
        else:
            added.append((anchor, key, text))
    return {"changed": changed, "deleted": [k for k, _ in base if k not in head_keys], "added": added}


def _claims(lanes: dict[str, dict]) -> dict[str, list[str]]:
    """lane -> the lanes it conflicts with, in lane order; the first claimant of a segment keeps it."""
    owner: dict[tuple[str, str], tuple[str, str | None]] = {}
    clash: dict[str, list[str]] = {}
    for lane, ch in lanes.items():
        claims = [("seg", k, t) for k, t in ch["changed"].items()] + [("seg", k, None) for k in ch["deleted"]]
        claims += [("new", k, t) for _, k, t in ch["added"]]
        for kind, key, text in claims:
            first = owner.setdefault((kind, key), (lane, text and text.strip()))
            if first[0] != lane and first[1] != (text and text.strip()):
                clash.setdefault(lane, []).append(first[0])
    return clash


def merge_module(base_text: str, heads: dict[str, str]) -> tuple[str, dict[str, list[str]]]:
    """The spliced module text and {lane: [lanes it conflicts with]}; conflicting lanes are left out."""
    base = segments(base_text)
    lanes = {lane: lane_changes(base, segments(text)) for lane, text in heads.items()}
    clash = _claims(lanes)
    kept = {lane: ch for lane, ch in lanes.items() if lane not in clash}
    return _emit(base, kept), clash


def _emit(base: list[tuple[str, str]], lanes: dict[str, dict]) -> str:
    changed = {k: t for ch in lanes.values() for k, t in ch["changed"].items()}
    deleted = {k for ch in lanes.values() for k in ch["deleted"]}
    out, done = [], set()

    def additions(anchor: str):
        for ch in lanes.values():
            for at, key, text in ch["added"]:
                if at == anchor and key not in done:
                    done.add(key)
                    out.append(text)
    additions(START)
    for key, text in base:
        if key not in deleted:
            out.append(changed.get(key, text))
        additions(key)
    return "".join(out)


def _unit_dumps(rel: str, text: str | None) -> dict[str, str]:
    if text is None:
        return {}
    return {u.key: ast.dump(u.node) for u in module_units(rel, text)[1]}


def _faithful(rel: str, base: str, head: str, merged: str) -> bool:
    """Every unit the lane changed or added has the lane's AST in the merged module."""
    try:
        before, after, got = (_unit_dumps(rel, t) for t in (base, head, merged))
    except SyntaxError:
        return False
    return all(got.get(k) == d for k, d in after.items() if before.get(k) != d)


def _text(data: bytes | None) -> str | None:
    return None if data is None else data.decode("utf-8", errors="surrogateescape")


def _merge_file(rel: str, base: bytes | None, heads: dict[str, bytes | None]) -> tuple[bytes | None, set[str]]:
    """The merged content of one file and the lanes that cannot be spliced into it."""
    texts = {lane: _text(h) for lane, h in heads.items()}
    if rel.endswith(".py") and base is not None and None not in texts.values():
        try:
            merged, clash = merge_module(_text(base), texts)
        except SyntaxError:
            merged, clash = None, {}
        if merged is not None:
            bad = set(clash) | {lane for lane, t in texts.items()
                                if lane not in clash and not _faithful(rel, _text(base), t, merged)}
            return merged.encode("utf-8", errors="surrogateescape"), bad
    first = next(iter(heads))
    return heads[first], {lane for lane, h in heads.items() if h != heads[first]}


def splice(base: dict[str, bytes], heads: dict[str, dict[str, bytes]]) -> dict:
    """Splice lane trees ({lane: files}, in splice order) into base. A lane that conflicts anywhere is
    dropped whole and the rest re-spliced. -> {files, spliced: [lane], conflicts: {lane: [file]}}."""
    lanes, conflicts = list(heads), {}
    while True:
        files, bad = dict(base), {}
        for rel in sorted({r for lane in lanes for r in changed_files(base, heads[lane])}):
            touching = {lane: heads[lane].get(rel) for lane in lanes if heads[lane].get(rel) != base.get(rel)}
            merged, losers = _merge_file(rel, base.get(rel), touching)
            for lane in losers:
                bad.setdefault(lane, []).append(rel)
            if merged is None:
                files.pop(rel, None)
            else:
                files[rel] = merged
        if not bad:
            return {"files": files, "spliced": lanes, "conflicts": conflicts}
        drop = max(bad, key=lanes.index)
        conflicts[drop] = sorted(bad[drop])
        lanes.remove(drop)


def write_tree(root: Path, files: dict[str, bytes]) -> None:
    for rel, data in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
