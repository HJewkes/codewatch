"""The control-coupling fixpoint (C-248 B7.1): which parameters are flags, and which flags originate here.

A parameter is control when it is branched on in flag form, stored to a `self` attribute its class
branches on in flag form, or forwarded bare to a control parameter, and it has evidence. Evidence is a
bool default or a literal argument at a call site (own evidence), or a forward from a parameter with
evidence. Both sets grow to a fixpoint over the forwarding links.
"""

from __future__ import annotations

import ast
from collections import defaultdict

from planner.coupling import Facts, _bound_args
from planner.units import own_nodes

Param = tuple[str, str]


def _bool_defaults(fn: ast.AST) -> set[str]:
    a = fn.args
    positional = a.posonlyargs + a.args
    pairs = list(zip(positional[len(positional) - len(a.defaults):], a.defaults)) + list(zip(a.kwonlyargs, a.kw_defaults))
    return {arg.arg for arg, d in pairs if isinstance(d, ast.Constant) and isinstance(d.value, bool)}


def _self_stores(fn: ast.AST, names: list[str]) -> dict[str, str]:
    """param -> the `self.x` it is stored to, for `self.x = p`."""
    out = {}
    for node in own_nodes(fn):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Name) and node.value.id in names:
            for t in node.targets:
                if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self":
                    out[node.value.id] = f"self.{t.attr}"
    return out


def _links(fx: dict[str, Facts]) -> tuple[set[Param], set[Param], list[tuple[Param, Param]]]:
    """Directly branched parameters, parameters with own evidence, and forwarding links."""
    class_tested: dict[str | None, set[str]] = defaultdict(set)
    for f in fx.values():
        class_tested[f.unit.cls] |= {n for n in f.tested if n.startswith("self.")}
    direct, evidence, forwards = set(), set(), []
    for key, f in sorted(fx.items()):
        direct |= {(key, p) for p in f.params if p in f.tested}
        tested_attrs = class_tested[f.unit.cls] if f.unit.cls else set()
        direct |= {(key, p) for p, attr in _self_stores(f.unit.node, f.params).items() if attr in tested_attrs}
        evidence |= {(key, p) for p in _bool_defaults(f.unit.node)}
        for call, target in f.calls:
            for name, arg in _bound_args(call, fx[target]) if target in fx else ():
                if isinstance(arg, ast.Constant):
                    evidence.add((target, name))
                elif isinstance(arg, ast.Name) and arg.id in f.params:
                    forwards.append(((key, arg.id), (target, name)))
    return direct, evidence, forwards


def _grow(seed: set[Param], links: list[tuple[Param, Param]]) -> set[Param]:
    out, changed = set(seed), True
    while changed:
        changed = False
        for a, b in links:
            if a in out and b not in out:
                out.add(b)
                changed = True
    return out


def control_params(fx: dict[str, Facts]) -> dict[str, dict[str, bool]]:
    """unit key -> {control parameter: is a flag origin}."""
    direct, own_evidence, forwards = _links(fx)
    control = _grow(direct, [(b, a) for a, b in forwards])
    evidence = _grow(own_evidence, forwards)
    out: dict[str, dict[str, bool]] = defaultdict(dict)
    for key, p in sorted(control & evidence):
        out[key][p] = (key, p) in own_evidence
    return dict(out)
