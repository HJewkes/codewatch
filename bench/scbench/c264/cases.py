"""C-264 arm 6: cut rejected parametrize cases out of their case tables.

A case table is the list or tuple literal a test function's one `parametrize` decorator takes
as its values, inline or through a module-level name (`CASES = [...]`). Case k of a test is
row k of its table, by pytest's collection order, so a table is cut only when the gate
collected exactly as many cases as the table has rows. A row stays while any admitted case
of any test using the table needs it. A table goes untouched when a test the gate did not
judge uses it, or when another file names it. A test with stacked `parametrize` decorators, a
class-level one, or a computed table is left whole.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Mapping, Sequence

from remediation.admission import test_names

Rows = list[tuple[int, int]]


def _functions(tree: ast.Module) -> dict[str, tuple[ast.FunctionDef | ast.AsyncFunctionDef, ast.ClassDef | None]]:
    found = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            found[node.name] = (node, None)
        elif isinstance(node, ast.ClassDef):
            found |= {f"{node.name}::{m.name}": (m, node) for m in node.body
                      if isinstance(m, ast.FunctionDef | ast.AsyncFunctionDef)}
    return found


def _parametrize(node: ast.AST) -> list[ast.Call]:
    return [d for d in getattr(node, "decorator_list", []) if isinstance(d, ast.Call) and "parametrize" in ast.unparse(d.func)]


def _values(call: ast.Call) -> ast.expr | None:
    if len(call.args) >= 2:
        return call.args[1]
    return next((k.value for k in call.keywords if k.arg == "argvalues"), None)


def _named(tree: ast.Module) -> dict[str, ast.List | ast.Tuple]:
    """Module-level `NAME = [...]` and `NAME: T = [...]` assignments of a list or tuple literal."""
    found = {}
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if len(targets) == 1 and isinstance(targets[0], ast.Name) and isinstance(node.value, ast.List | ast.Tuple):
            found[targets[0].id] = node.value
    return found


INLINE = "@"


def table_key(source: str, tail: str) -> str | None:
    """The table of a test's single `parametrize`: its module-level name, or `@` and the tail
    for an inline literal; None when there is no one plain table."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    function, cls = _functions(tree).get(tail, (None, None))
    calls = _parametrize(function) if function else []
    if len(calls) != 1 or (cls is not None and _parametrize(cls)):
        return None
    values = _values(calls[0])
    if isinstance(values, ast.Name) and values.id in _named(tree):
        return values.id
    return INLINE + tail if isinstance(values, ast.List | ast.Tuple) else None


def _table(source: str, key: str) -> ast.List | ast.Tuple | None:
    tree = ast.parse(source)
    if key.startswith(INLINE):
        function = _functions(tree).get(key[1:], (None, None))[0]
        calls = _parametrize(function) if function else []
        values = _values(calls[0]) if len(calls) == 1 else None
        return values if isinstance(values, ast.List | ast.Tuple) else None
    return _named(tree)[key]


def _offsets(source: str) -> list[int]:
    starts, total = [], 0
    for line in source.split("\n"):
        starts.append(total)
        total += len(line) + 1
    return starts


def _at(source: str, starts: list[int], line: int, col: int) -> int:
    text = source.split("\n")[line - 1]
    return starts[line - 1] + len(text.encode()[:col].decode(errors="replace"))


def rows(source: str, key: str) -> Rows | None:
    """Each row's character span in `source`; None for a table with a starred row or none."""
    try:
        table = _table(source, key)
    except SyntaxError:
        return None
    if table is None or any(isinstance(e, ast.Starred) for e in table.elts):
        return None
    starts = _offsets(source)
    return [(_at(source, starts, e.lineno, e.col_offset), _at(source, starts, e.end_lineno or e.lineno, e.end_col_offset or 0))
            for e in table.elts]


def table_text(source: str, key: str) -> str | None:
    spans = rows(source, key)
    return None if spans is None else repr([source[a:b] for a, b in spans])


def _line_span(source: str, start: int, end: int) -> tuple[int, int] | None:
    """The whole lines of a row that sits alone on them, trailing comma and comment included."""
    head = source.rfind("\n", 0, start) + 1
    tail = source.find("\n", end)
    tail = len(source) if tail < 0 else tail
    if source[head:start].strip() or not re.fullmatch(r"\s*,?\s*(#.*)?", source[end:tail]):
        return None
    return head, min(tail + 1, len(source))


def drop_rows(source: str, key: str, drop: set[int]) -> str:
    """`source` without the table's rows `drop`; unchanged if the result would not parse."""
    spans = rows(source, key) or []
    kept = [i for i in range(len(spans)) if i not in drop]
    cuts = []
    for i in sorted(d for d in drop if d < len(spans)):
        start, end = spans[i]
        later = any(k > i for k in kept)
        earlier = [spans[k][1] for k in kept if k < i]
        inline = (start, spans[i + 1][0]) if later else (earlier[-1] if earlier else start, end)
        cuts.append(_line_span(source, start, end) or inline)
    merged: list[list[int]] = []
    for start, end in sorted(cuts):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    text = source
    for start, end in reversed(merged):
        text = text[:start] + text[end:]
    try:
        ast.parse(text)
    except SyntaxError:
        return source
    return text


def _users(source: str, key: str) -> set[str]:
    """The file's test functions whose text names the table."""
    if key.startswith(INLINE):
        return {key[1:]}
    pattern = rf"\b{re.escape(key)}\b"
    named = {tail for tail, (node, _) in _functions(ast.parse(source)).items() if re.search(pattern, ast.unparse(node))}
    return named & test_names(source)


def _cuttable(key: str, users: set[str], judged: set[str], whole_rejected: set[str], elsewhere: str) -> bool:
    """Every user was judged now; an inline table of a test cut whole goes with it; another
    file naming the table may use it."""
    if key.startswith(INLINE):
        return key[1:] not in whole_rejected
    return users <= judged and not re.search(rf"\b{re.escape(key)}\b", elsewhere)


def _needed(user: str, n: int, admitted: set[str], whole_rejected: set[str], cases: Mapping[str, list[str]]) -> set[int]:
    if user in whole_rejected:
        return set()
    ids = cases.get(user)
    if ids is None or len(ids) != n:
        return set(range(n))
    return {i for i, case in enumerate(ids) if case in admitted}


def _local(prefix: str, ids: Sequence[str]) -> set[str]:
    return {i[len(prefix):] for i in ids if i.startswith(prefix)}


def case_cuts(source: str, path: str, admitted: Sequence[str], rejected: Sequence[str],
              cases: Mapping[str, Sequence[str]], elsewhere: str = "") -> dict[str, set[int]]:
    """Per table key of the file, the rows no admitted case of the judged tests needs."""
    prefix = f"{path}::"
    admitted_here, rejected_here = _local(prefix, admitted), _local(prefix, rejected)
    whole_rejected = {t for t in rejected_here if "[" not in t}
    judged = {t.split("[", 1)[0] for t in admitted_here | rejected_here}
    local_cases = {t[len(prefix):]: [c[len(prefix):] for c in ids] for t, ids in cases.items() if t.startswith(prefix)}
    cuts = {}
    for key in sorted({k for t in judged if (k := table_key(source, t))}):
        spans, users = rows(source, key), _users(source, key)
        if spans is None or not _cuttable(key, users, judged, whole_rejected, elsewhere):
            continue
        needed = set().union(*(_needed(u, len(spans), admitted_here, whole_rejected, local_cases) for u in users))
        if drop := set(range(len(spans))) - needed:
            cuts[key] = drop
    return cuts


Recorded = dict[str, tuple[str, set[int]]]


def record(recorded: Recorded, a1: str, current: str, cuts: Mapping[str, set[int]]) -> int:
    """Add `cuts`, row indices into the current table, to `recorded` as indices into A1's
    table, keyed by A1's table text; returns the rows added."""
    added = 0
    for key, drop in cuts.items():
        original, spans = table_text(a1, key), rows(current, key) or []
        before = recorded[key][1] if key in recorded and recorded[key][0] == original else set()
        kept = [i for i in range(len(rows(a1, key) or [])) if i not in before]
        if original is None or len(kept) != len(spans):
            continue
        recorded[key] = (original, before | {kept[j] for j in drop})
        added += len(drop)
    return added


def apply(text: str, recorded: Recorded) -> str:
    """Cut each recorded table's rows while the table still equals A1's recorded text."""
    for key, (original, drop) in sorted(recorded.items()):
        if table_text(text, key) == original:
            text = drop_rows(text, key, drop)
    return text
