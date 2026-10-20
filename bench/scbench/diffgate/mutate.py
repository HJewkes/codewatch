"""Generated inputs: one-edit variants of the JSON a recorded case feeds the program (C-242).

The tests mostly exercise valid input; the error paths, where reworded messages hide, need invalid
input. Each JSON document a case reads (stdin, or a *.json file in its copied trees) yields variants
that each apply one edit at one node: delete a key, set it to null, set it to "", swap its type, empty
a list, or duplicate a list's first item. Nodes are visited breadth-first to MAX_DEPTH; a document
yields at most MAX_PER_DOC variants, so every case's earliest structure is covered first.
"""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
from collections.abc import Iterator
from pathlib import Path

MAX_DEPTH, MAX_PER_DOC, MAX_JSON_BYTES = 4, 24, 65536
DELETE = object()


def _swapped(value):
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return "x"
    if isinstance(value, str):
        return 0
    return [] if isinstance(value, dict) else {}


def _edits(value) -> Iterator[tuple[str, object]]:
    yield "null", None
    if isinstance(value, str) and value:
        yield "empty", ""
    yield "type", _swapped(value)
    if isinstance(value, list) and value:
        yield "empty", []
        yield "dup0", value + [value[0]]


def _children(node):
    if isinstance(node, dict):
        return list(node.items())
    return list(enumerate(node)) if isinstance(node, list) else []


def _nodes(doc) -> Iterator[tuple[tuple, object]]:
    queue = [((), doc)]
    while queue:
        path, node = queue.pop(0)
        yield path, node
        if len(path) < MAX_DEPTH:
            queue.extend((path + (k,), v) for k, v in _children(node))


def _replace(doc, path: tuple, value):
    if not path:
        return value
    copy = json.loads(json.dumps(doc))
    parent = copy
    for key in path[:-1]:
        parent = parent[key]
    if value is DELETE:
        del parent[path[-1]]
    else:
        parent[path[-1]] = value
    return copy


def variants(doc) -> list[tuple[str, object]]:
    out = []
    for path, node in _nodes(doc):
        label = "$" + "".join(f"[{k!r}]" for k in path)
        if path and isinstance(path[-1], str):
            out.append((f"{label}:delete", _replace(doc, path, DELETE)))
        out.extend((f"{label}:{name}", _replace(doc, path, value)) for name, value in _edits(node))
    return out[:MAX_PER_DOC]


def _json(data: bytes):
    if len(data) > MAX_JSON_BYTES:
        return None
    try:
        return json.loads(data)
    except (ValueError, UnicodeDecodeError):
        return None


def _write_variant(case_dir: Path, out_dir: Path, case: dict, target: str, data: bytes) -> Path | None:
    variant = {**case, "source": "generated", "nodeids": [], "parent": case_dir.name, "edit": target}
    if target == "stdin":
        variant["stdin_b64"] = base64.b64encode(data).decode()
    key = hashlib.sha1(json.dumps(variant, sort_keys=True).encode() + data).hexdigest()[:16]
    destination = out_dir / f"g{key}"
    if destination.exists():
        return None
    shutil.copytree(case_dir / "files", destination / "files", symlinks=True)
    if target != "stdin":
        (destination / "files" / target.split(":", 1)[0]).write_bytes(data)
    (destination / "case.json").write_text(json.dumps(variant, indent=1, sort_keys=True))
    return destination


def _documents(case_dir: Path, case: dict) -> Iterator[tuple[str, object]]:
    if case.get("stdin_b64"):
        doc = _json(base64.b64decode(case["stdin_b64"]))
        if doc is not None:
            yield "stdin", doc
    for path in sorted((case_dir / "files").rglob("*.json")):
        doc = _json(path.read_bytes()) if path.is_file() else None
        if doc is not None:
            yield path.relative_to(case_dir / "files").as_posix(), doc


def generate(case_dir: Path, out_dir: Path) -> list[Path]:
    """Write the case's variants as new cases under `out_dir`; returns the new case dirs."""
    case = json.loads((case_dir / "case.json").read_text())
    written = []
    for target, doc in _documents(case_dir, case):
        for label, mutated in variants(doc):
            data = json.dumps(mutated).encode()
            tag = "stdin" if target == "stdin" else f"{target}:{label}"
            made = _write_variant(case_dir, out_dir, {**case, "edit_label": label}, tag, data)
            written += [made] if made else []
    return written
