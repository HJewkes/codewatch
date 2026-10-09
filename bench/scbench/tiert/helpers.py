"""Follows a test's calls into helpers defined in the tree's own test-role modules."""

from __future__ import annotations

import ast
from collections.abc import Iterable

from .collect import Function, Module
from .oracle import NONE, STRONG, oracle_nodes, strength_of

MAX_DEPTH = 4


class Resolver:
    def __init__(self, modules: Iterable[Module]) -> None:
        self.by_path = {m.path: m for m in modules}
        self.by_dotted = {m.dotted: m for m in self.by_path.values()}
        self._memo: dict[tuple[str, str, int], int] = {}

    def module(self, dotted: str) -> Module | None:
        """A module by import name; a suffix match covers `src/` layouts and nested roots."""
        if not dotted:
            return None
        found = self.by_dotted.get(dotted)
        if found is not None:
            return found
        matches = [m for d, m in self.by_dotted.items() if d.endswith(f".{dotted}")]
        return matches[0] if len(matches) == 1 else None

    def _aliased_module(self, module: Module, alias: str) -> Module | None:
        source, attr = module.imports.get(alias, ("", None))
        return self.module(source if attr is None else f"{source}.{attr}")

    def _method(self, module: Module, cls: str, name: str, seen: frozenset[str] = frozenset()) -> Function | None:
        found = module.functions.get(f"{cls}.{name}")
        if found is not None or cls in seen:
            return found
        for base in module.bases.get(cls, ()):
            if base in module.bases:
                found = self._method(module, base, name, seen | {cls})
            else:
                source, attr = module.imports.get(base, ("", None))
                target = self.module(source)
                found = self._method(target, attr, name, seen | {cls}) if target and attr else None
            if found is not None:
                return found
        return None

    def resolve(self, call: ast.Call, fn: Function) -> Function | None:
        module = self.by_path[fn.path]
        func = call.func
        if isinstance(func, ast.Name):
            return self._resolve_name(module, func.id)
        if not (isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name)):
            return None
        base = func.value.id
        if base in ("self", "cls") and fn.owner:
            return self._method(module, fn.owner, func.attr)
        if base in module.bases:
            return self._method(module, base, func.attr)
        target = self._aliased_module(module, base)
        return target.functions.get(func.attr) if target else None

    def _resolve_name(self, module: Module, name: str) -> Function | None:
        local = module.functions.get(name)
        if local is not None:
            return local
        source, attr = module.imports.get(name, ("", None))
        target = self.module(source) if attr else None
        return target.functions.get(attr) if target else None

    def strength(self, fn: Function, depth: int = 0, stack: frozenset[tuple[str, str]] = frozenset()) -> int:
        """The strongest oracle in `fn` or in a helper it reaches within `MAX_DEPTH` calls."""
        key = (fn.path, fn.qualname, depth)
        if key not in self._memo:
            self._memo[key] = self._strength(fn, depth, stack | {(fn.path, fn.qualname)})
        return self._memo[key]

    def _strength(self, fn: Function, depth: int, stack: frozenset[tuple[str, str]]) -> int:
        best = max((strength_of(n) for n in oracle_nodes(fn.node)), default=NONE)
        if best == STRONG or depth >= MAX_DEPTH:
            return best
        for call in (n for n in ast.walk(fn.node) if isinstance(n, ast.Call)):
            helper = self.resolve(call, fn)
            if helper is None or (helper.path, helper.qualname) in stack:
                continue
            best = max(best, self.strength(helper, depth + 1, stack))
            if best == STRONG:
                break
        return best
