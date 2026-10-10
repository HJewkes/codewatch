"""Python source files and the functions in them, read with the standard library's `ast`."""

from __future__ import annotations

import ast
import textwrap
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

SKIPPED_DIRS = frozenset({"__pycache__", "node_modules", "site-packages", "venv"})
TEST_DIRS = frozenset({"test", "tests"})


@dataclass(frozen=True)
class FunctionSpan:
    qualname: str
    start: int
    end: int
    body_start: int
    source: str


def source_files(root: Path) -> list[str]:
    """Non-test `.py` files under `root`, as sorted POSIX paths relative to it."""
    found = []
    for path in root.rglob("*.py"):
        parts = path.relative_to(root).parts
        if any(p.startswith(".") or p in SKIPPED_DIRS for p in parts[:-1]):
            continue
        if not is_test_file(parts):
            found.append("/".join(parts))
    return sorted(found)


def is_test_file(parts: tuple[str, ...]) -> bool:
    name = parts[-1]
    in_test_dir = any(p in TEST_DIRS for p in parts[:-1])
    return in_test_dir or name == "conftest.py" or name.startswith("test_") or name.endswith("_test.py")


def functions(text: str) -> list[FunctionSpan]:
    """Every function and method, nested ones included; empty when the file does not parse."""
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return []
    lines = text.splitlines()
    return list(_walk(tree, "", lines))


def _walk(node: ast.AST, prefix: str, lines: list[str]) -> Iterator[FunctionSpan]:
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
            qualname = prefix + child.name
            yield _span(child, qualname, lines)
            yield from _walk(child, qualname + ".", lines)
        elif isinstance(child, ast.ClassDef):
            yield from _walk(child, prefix + child.name + ".", lines)
        else:
            yield from _walk(child, prefix, lines)


def _span(node: ast.FunctionDef | ast.AsyncFunctionDef, qualname: str, lines: list[str]) -> FunctionSpan:
    end = node.end_lineno or node.lineno
    first = min([node.lineno, *(d.lineno for d in node.decorator_list)])
    source = textwrap.dedent("\n".join(lines[first - 1 : end]))
    return FunctionSpan(qualname, node.lineno, end, node.body[0].lineno, source)
