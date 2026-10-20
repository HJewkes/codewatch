"""Every interface detector of one module, keyed by unit (coupling.py, control.py)."""

from __future__ import annotations

import ast

from planner.classes import init_fields
from planner.control import control_params
from planner.coupling import _mutated, common, facts, module_mutables, pass_through, stamp, unused
from planner.cutwidth import _parents
from planner.units import Unit


def detect(tree: ast.Module, units: list[Unit], exempt: set[str]) -> dict[str, dict[str, list[str]]]:
    """unit key -> {kind: findings} for stamp, pass-through, unused, common, control and origins."""
    fx = facts(units)
    parents = {k: _parents(f.unit.node) for k, f in fx.items()}
    mutates = {k: _mutated(f, f.params, parents[k]) for k, f in fx.items()}
    mutables, fields, control = module_mutables(tree), init_fields(tree), control_params(fx)
    out = {}
    for key, f in sorted(fx.items()):
        flags = control.get(key, {})
        out[key] = {"stamp": stamp(f, parents[key]), "pass_through": pass_through(f),
                    "unused": unused(f, exempt), "common": common(f, fx, mutates, parents[key], mutables, fields),
                    "control": sorted(flags), "origins": sorted(p for p, own in flags.items() if own)}
    return out
