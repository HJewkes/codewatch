"""C-239 prototype: the static scan of a Python tree that report.py's sections read."""

from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

SKIP = {".venv", "venv", ".codewatch", ".git", "__pycache__", ".evaluation_tests"}
ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")


@dataclass
class Fn:
    name: str
    line: int
    sig: str
    source: str
    errors: set[str] = field(default_factory=set)
    calls: set[str] = field(default_factory=set)
    keys: dict[str, str] = field(default_factory=dict)  # key -> "default" | "checked" | "required"


def py_files(root: Path, tests: bool) -> list[Path]:
    out = []
    for p in sorted(root.rglob("*.py")):
        rel = p.relative_to(root)
        if SKIP.intersection(rel.parts):
            continue
        is_test = rel.parts[0] in ("tests", "test") or rel.name.startswith("test_") or rel.name == "conftest.py"
        if is_test == tests:
            out.append(p)
    return out


def call_name(node: ast.Call) -> str | None:
    f = node.func
    return f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None


def str_const(node: ast.AST | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def scan_function(fn: ast.FunctionDef, qual: str, text: str) -> Fn:
    rec = Fn(qual, fn.lineno, ast.unparse(fn.args), ast.get_source_segment(text, fn) or "")
    for n in ast.walk(fn):
        if isinstance(n, ast.Call):
            name = call_name(n)
            if name:
                rec.calls.add(name)
            key = str_const(n.args[0]) if n.args else None
            if name == "get" and key:
                rec.keys.setdefault(key, "default" if len(n.args) > 1 else "checked")
        elif isinstance(n, ast.Compare) and isinstance(n.ops[0], (ast.In, ast.NotIn)) and str_const(n.left):
            rec.keys[n.left.value] = "checked"
        elif isinstance(n, ast.Subscript) and str_const(n.slice):
            rec.keys.setdefault(n.slice.value, "required")
        elif isinstance(n, ast.Constant) and isinstance(n.value, str) and ERROR_CODE.match(n.value):
            rec.errors.add(n.value)
        elif isinstance(n, ast.Raise) and n.exc is not None:
            rec.errors.update(s for s in (str_const(a) for a in getattr(n.exc, "args", [])) if s)
    return rec


def functions(root: Path) -> dict[str, Fn]:
    out: dict[str, Fn] = {}
    for path in py_files(root, tests=False):
        text = path.read_text(errors="replace")
        for qual, node in walk_defs(ast.parse(text), ""):
            out[qual] = scan_function(node, qual, text)
    return out


def walk_defs(tree: ast.AST, prefix: str):
    for node in getattr(tree, "body", []):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield prefix + node.name, node
            yield from walk_defs(node, prefix + node.name + ".")
        elif isinstance(node, ast.ClassDef):
            yield from walk_defs(node, prefix + node.name + ".")


@dataclass
class TestFn:
    path: str
    name: str
    line: int
    text: str
    dicts: list[dict]
    kwargs: dict[str, object]
    asserted: set[str]


def literal(node: ast.AST):
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return None


def test_inputs(node: ast.AST) -> list[dict]:
    """Dict literals in a test, and dicts inside JSON strings, as candidate program inputs."""
    found: list[dict] = []
    for n in ast.walk(node):
        value = literal(n) if isinstance(n, ast.Dict) else None
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.strip()[:1] in "[{":
            try:
                value = json.loads(n.value)
            except ValueError:
                value = None
        found.extend(nested_dicts(value))
    return found


def nested_dicts(value) -> list[dict]:
    if isinstance(value, dict):
        return [value, *[d for v in value.values() for d in nested_dicts(v)]]
    if isinstance(value, list):
        return [d for v in value for d in nested_dicts(v)]
    return []


def helper_defaults(tree: ast.Module) -> dict[str, dict[str, object]]:
    """Keyword defaults of a test file's own helpers, so `run(x)` counts as `run(x, execute=True)`."""
    out = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("test"):
            names = [a.arg for a in node.args.args][-len(node.args.defaults):] if node.args.defaults else []
            out[node.name] = {n: literal(d) for n, d in zip(names, node.args.defaults)}
    return out


def call_kwargs(node: ast.AST, helpers: dict[str, dict[str, object]]) -> dict[str, object]:
    kwargs: dict[str, object] = {}
    for c in ast.walk(node):
        if isinstance(c, ast.Call):
            kwargs.update({k: v for k, v in helpers.get(call_name(c) or "", {}).items() if k not in kwargs})
            kwargs.update({k.arg: literal(k.value) for k in c.keywords if k.arg})
    return kwargs


def tests(root: Path) -> list[TestFn]:
    out = []
    for path in py_files(root, tests=True):
        text = path.read_text(errors="replace")
        tree = ast.parse(text)
        helpers = helper_defaults(tree)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test"):
                kwargs = call_kwargs(node, helpers)
                asserted = {s for a in ast.walk(node) if isinstance(a, ast.Assert)
                            for s in (str_const(c) for c in ast.walk(a)) if s and ERROR_CODE.match(s)}
                out.append(TestFn(str(path.relative_to(root)), node.name, node.lineno,
                                  ast.get_source_segment(text, node) or "", test_inputs(node), kwargs, asserted))
    return out


def cli_flags(root: Path) -> set[str]:
    flags = set()
    for path in py_files(root, tests=False):
        flags.update(m.group(1) for m in re.finditer(r"[\"']--([a-z][a-z0-9-]*)", path.read_text(errors="replace")))
    return flags
