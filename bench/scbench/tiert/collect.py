"""Parses a tree's test-role Python files into modules, pytest test functions and helpers."""

from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

SKIP_DIRS = frozenset({"node_modules", "__pycache__", "site-packages", "venv", "build", "dist"})
TEST_DIRS = frozenset({"test", "tests", "testing"})

FunctionNode = ast.FunctionDef | ast.AsyncFunctionDef


@dataclass(frozen=True)
class Function:
    path: str
    qualname: str
    node: FunctionNode
    owner: str | None
    markers: tuple[str, ...] = ()


@dataclass
class Module:
    path: str
    dotted: str
    is_package: bool
    functions: dict[str, Function] = field(default_factory=dict)
    imports: dict[str, tuple[str, str | None]] = field(default_factory=dict)
    bases: dict[str, tuple[str, ...]] = field(default_factory=dict)


def is_test_file(rel: PurePosixPath) -> bool:
    return rel.suffix == ".py" and (rel.name.startswith("test_") or rel.stem.endswith("_test"))


def is_test_role(rel: PurePosixPath) -> bool:
    return is_test_file(rel) or rel.name == "conftest.py" or any(p in TEST_DIRS for p in rel.parts[:-1])


def python_files(root: Path) -> list[PurePosixPath]:
    """Test-role `.py` files under `root`, relative and sorted, skipping hidden and vendored dirs."""
    found = []
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS)
        base = PurePosixPath(Path(current).relative_to(root).as_posix())
        found.extend(base / f for f in files if is_test_role(base / f))
    return sorted(found)


def dotted_name(rel: PurePosixPath) -> str:
    parts = rel.with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def parse_module(root: Path, rel: PurePosixPath) -> Module | None:
    """The file's functions, classes and imports; None when it does not parse."""
    try:
        tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=str(rel))
    except (SyntaxError, UnicodeDecodeError, ValueError):
        return None
    module = Module(path=rel.as_posix(), dotted=dotted_name(rel), is_package=rel.name == "__init__.py")
    _index_body(module, tree.body, owner=None, class_markers=())
    _index_imports(module, tree)
    return module


def _index_body(module: Module, body: list[ast.stmt], owner: str | None, class_markers: tuple[str, ...]) -> None:
    for stmt in body:
        if not isinstance(stmt, FunctionNode | ast.ClassDef):
            continue
        qualname = stmt.name if owner is None else f"{owner}.{stmt.name}"
        if isinstance(stmt, FunctionNode):
            markers = class_markers + _markers(stmt.decorator_list)
            module.functions[qualname] = Function(module.path, qualname, stmt, owner, markers)
        else:
            module.bases[qualname] = tuple(ast.unparse(b) for b in stmt.bases)
            _index_body(module, stmt.body, qualname, class_markers + _markers(stmt.decorator_list))


def _markers(decorators: list[ast.expr]) -> tuple[str, ...]:
    """Names of `@pytest.mark.<name>` decorators, called or bare."""
    names = []
    for dec in decorators:
        target = dec.func if isinstance(dec, ast.Call) else dec
        text = ast.unparse(target)
        if text.startswith(("pytest.mark.", "mark.")):
            names.append(text.rsplit(".", 1)[-1])
    return tuple(names)


def _index_imports(module: Module, tree: ast.Module) -> None:
    for stmt in tree.body:
        if isinstance(stmt, ast.Import):
            for alias in stmt.names:
                bound = alias.name if alias.asname else alias.name.split(".")[0]
                module.imports[alias.asname or bound] = (bound, None)
        elif isinstance(stmt, ast.ImportFrom):
            source = _absolute(module, stmt.module, stmt.level)
            for alias in stmt.names:
                module.imports[alias.asname or alias.name] = (source, alias.name)


def _absolute(module: Module, name: str | None, level: int) -> str:
    if level == 0:
        return name or ""
    package = module.dotted.split(".") if module.is_package else module.dotted.split(".")[:-1]
    base = package[: len(package) - level + 1]
    return ".".join([*base, name] if name else base)


def is_test_function(fn: Function) -> bool:
    """pytest's default collection: `test*` functions, and `test*` methods of `Test*` classes."""
    if not is_test_file(PurePosixPath(fn.path)) or not fn.node.name.startswith("test"):
        return False
    return fn.owner is None or all(part.startswith("Test") for part in fn.owner.split("."))
