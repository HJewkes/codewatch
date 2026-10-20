"""Function-level splice (C-248 S6): merge the lanes of one wave into the wave's base tree.

A module is cut into segments: each module-level statement, and inside a module-level class its header
and each body statement. A def segment's key is its qualified name, an assignment's the names it binds
(so two lanes setting one constant differently collide), and any other statement's key is its own text,
so an edit to it reads as a deletion plus an addition. A segment carries the comments and blank lines
above it. Per lane, a segment is changed (beyond the blank lines around it), deleted or added (anchored after the nearest earlier segment
that is in the base). Two lanes conflict when they make different changes to one segment or add one key
with different text, and when both change, add or delete text-keyed segments in one body (the module, or
one class body), even identically: the later lane in lane order is the conflict. One lane alone may
change text-keyed segments freely. Additions at one anchor go in lane order, and the result honours every
pair a lane puts out of base order (runner.order). A non-Python file changed by two lanes differently is a
conflict too. A file only one lane touches is that lane's file, byte for byte, with no splice.

Every Python file two or more lanes touch is then checked, on every path: a lane whose own file does not
parse is in conflict, and the result must parse. The result must preserve each lane's segments in that
lane's order and with its text, except where another lane changed a segment or moved a pair out of base
order; what the lane added is there and what it deleted is gone. Otherwise the lane is a conflict. A lane
in conflict is left out and reported, never half-applied.
"""

from __future__ import annotations

import ast
import shutil
from collections import Counter
from pathlib import Path

from runner.order import asserted, keeps_order, ordered

SKIP = {".git", ".venv", "venv", ".codewatch", "__pycache__", ".pytest_cache", ".ruff_cache"}
START = "^start"


def tree_files(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*"))
            if p.is_file() and not SKIP.intersection(p.relative_to(root).parts)}


def changed_files(base: dict[str, bytes], head: dict[str, bytes]) -> list[str]:
    return sorted(k for k in base.keys() | head.keys() if base.get(k) != head.get(k))


def _bound(node: ast.stmt) -> list[str]:
    if not isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        return []
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    names = (n for t in targets for n in ast.walk(t))
    return sorted({n.id for n in names if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)})


def _key(node: ast.stmt, lines: list[str], prefix: str) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return prefix + node.name
    if names := _bound(node):
        return prefix + "=" + ",".join(names)
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


def _text_body(key: str) -> str | None:
    """The body ("" for the module, "K." for class K) of a text-keyed segment; None for any other."""
    body, bar, _ = key.partition("|")
    return body if bar else None


def _lane_claims(ch: dict) -> list[tuple[str, str, str | None]]:
    claims = [("seg", k, t) for k, t in ch["changed"].items()] + [("seg", k, None) for k in ch["deleted"]]
    return claims + [("new", k, t) for _, k, t in ch["added"]]


def _claims(lanes: dict[str, dict]) -> dict[str, list[str]]:
    """lane -> the lanes it conflicts with, in lane order; the first claimant of a segment keeps it, and
    the first lane to touch a text-keyed segment in a body keeps that body's text-keyed segments."""
    owner: dict[tuple[str, str], tuple[str, str | None]] = {}
    clash: dict[str, list[str]] = {}
    for lane, ch in lanes.items():
        claims = _lane_claims(ch)
        for kind, key, text in claims:
            first = owner.setdefault((kind, key), (lane, text and text.strip()))
            if first[0] != lane and first[1] != (text and text.strip()):
                clash.setdefault(lane, []).append(first[0])
        for body in {b for _, key, _ in claims if (b := _text_body(key)) is not None}:
            first = owner.setdefault(("text", body), (lane, None))[0]
            if first != lane:
                clash.setdefault(lane, []).append(first)
    return clash


def merge_module(base_text: str, heads: dict[str, str]) -> tuple[str, dict[str, list[str]]]:
    """The spliced module text and {lane: [lanes it conflicts with]}; conflicting lanes are left out."""
    base, cut = segments(base_text), {lane: segments(text) for lane, text in heads.items()}
    lanes = {lane: lane_changes(base, cut[lane]) for lane in heads}
    clash = _claims(lanes)
    kept = {lane: ch for lane, ch in lanes.items() if lane not in clash}
    pieces = dict(_emit(base, kept))
    asserts = {lane: asserted(_keys(base), _keys(cut[lane])) for lane in kept}
    keys, losers = ordered(list(pieces), asserts)
    for lane in losers:
        clash[lane] = [other for other in kept if other != lane]
    texts = _layout(pieces, keys, {lane: cut[lane] for lane in kept if lane not in losers}, asserts)
    return "".join(t if t.endswith("\n") or i == len(texts) - 1 else t + "\n" for i, t in enumerate(texts)), clash


def _layout(pieces: dict[str, str], keys: list[str], cut: dict[str, list], asserts: dict) -> list[str]:
    """Each segment's text in order; a segment a lane moved takes that lane's blank lines with it."""
    texts = {}
    for lane, segs in cut.items():
        moved = {k for pair in asserts[lane] for k in pair}
        for key, text in segs:
            if key in moved and key in pieces and text.strip() == pieces[key].strip():
                texts.setdefault(key, text)
    return [texts.get(k, pieces[k]) for k in keys]


def _keys(segs: list[tuple[str, str]]) -> list[str]:
    return [k for k, _ in segs]


def _emit(base: list[tuple[str, str]], lanes: dict[str, dict]) -> list[tuple[str, str]]:
    """(key, text) of the merged module in base order, each addition after its anchor."""
    changed = {k: t for ch in lanes.values() for k, t in ch["changed"].items()}
    deleted = {k for ch in lanes.values() for k in ch["deleted"]}
    out, done = [], set()

    def additions(anchor: str):
        for ch in lanes.values():
            for at, key, text in ch["added"]:
                if at == anchor and key not in done:
                    done.add(key)
                    out.append((key, text))
    additions(START)
    for key, text in base:
        if key not in deleted:
            out.append((key, changed.get(key, text)))
        additions(key)
    return out


def _parses(text: str | None) -> bool:
    try:
        ast.parse(text or "")
    except (SyntaxError, ValueError):
        return False
    return True


def _faithful(lane: str, base: list, heads: dict[str, list], merged: list) -> bool:
    """The merged module keeps the lane's segments in the lane's order and with the lane's text, except a
    segment another lane changed or a pair another lane put out of base order; every segment the lane
    added is there and every segment it deleted is gone."""
    before, got = {k: t.strip() for k, t in base}, {k: t.strip() for k, t in merged}
    others = [heads[o] for o in heads if o != lane]
    edited = {k for segs in others for k, t in segs if before.get(k) != t.strip()}
    mine = heads[lane]
    text = all(got[k] == t.strip() or k in edited for k, t in mine if k in got)
    added = all(k in got for k, _ in mine if k not in before)
    deleted = not any(k in got for k in before.keys() - set(_keys(mine)))
    theirs = {pair for segs in others for pair in asserted(_keys(base), _keys(segs))}
    own = asserted(_keys(base), _keys(mine))
    return text and added and deleted and keeps_order(_keys(mine), _keys(merged), own, theirs)


def _text(data: bytes | None) -> str | None:
    return None if data is None else data.decode("utf-8", errors="surrogateescape")


def _splice_module(base: str, texts: dict[str, str]) -> tuple[bytes, set[str]] | None:
    """The function-level merge, or None when the base itself does not parse."""
    if not _parses(base):
        return None
    merged, clash = merge_module(base, texts)
    bad = set(clash)
    if _parses(merged):
        heads = {lane: segments(t) for lane, t in texts.items() if lane not in clash}
        before, got = segments(base), segments(merged)
        bad |= {lane for lane in heads if not _faithful(lane, before, heads, got)}
    return merged.encode("utf-8", errors="surrogateescape"), bad


def _merge_file(rel: str, base: bytes | None, heads: dict[str, bytes | None]) -> tuple[bytes | None, set[str]]:
    """The merged content of one file and the lanes that cannot be spliced into it. A file one lane
    touches is that lane's file. A Python result that does not parse, on any path, puts every lane
    touching the file in conflict."""
    if len(heads) == 1:
        return next(iter(heads.values())), set()
    texts = {lane: _text(h) for lane, h in heads.items()}
    python = rel.endswith(".py")
    if python and (broken := {lane for lane, t in texts.items() if t is not None and not _parses(t)}):
        return base, broken
    spliced = None
    if python and base is not None and None not in texts.values():
        spliced = _splice_module(_text(base), texts)
    if spliced is None:
        first = next(iter(heads))
        spliced = heads[first], {lane for lane, h in heads.items() if h != heads[first]}
    merged, bad = spliced
    if python and merged is not None and not _parses(_text(merged)):
        bad = set(heads)
    return merged, bad


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
    """Write files into root, emptied first so no file of an earlier splice is left behind."""
    shutil.rmtree(root, ignore_errors=True)
    for rel, data in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
