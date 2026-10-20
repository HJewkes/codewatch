"""Coupling and cohesion counts for the corpus (C-248 S3c), from the cleanup planner's own detectors.

Units (planner/detect.py, module-scoped, no dispatch exemption since `unused` is not measured):
  control         control parameters, the control-coupling fixpoint's flags (each one a crossing)
  control_origin  those with their own evidence, the flag origins
  stamp           stamp-coupled parameters
  common          common-coupling findings: global stores, in-place writes to module mutables,
                  temporary-field writes and parameter bags
Classes (planner/classes.py): lcom4, and temp_fields, the number of temporary attributes.
Modules (planner/modules.py): cycle, the number of modules in the import cycle it sits in (0 if none).
Units that share a key (a property and its setter) share the detector's findings for that key, as in
the planner.
"""

from __future__ import annotations

import ast

from calibration.imports import edges, module_name
from planner.classes import class_fact
from planner.detect import detect
from planner.modules import cycles
from planner.units import module_units

UNIT_FIELDS = ("control", "control_origin", "stamp", "common")
NO_FINDINGS = dict.fromkeys(UNIT_FIELDS, 0)


def unit_coupling(rel: str, text: str) -> dict[str, dict[str, int]]:
    """unit key -> the four unit counts."""
    parsed = module_units(rel, text)
    if not parsed:
        return {}
    found = detect(*parsed, exempt=set())
    return {key: {"control": len(d["control"]), "control_origin": len(d["origins"]),
                  "stamp": len(d["stamp"]), "common": len(d["common"])} for key, d in found.items()}


def class_cohesion(node: ast.ClassDef) -> dict[str, int]:
    fact = class_fact(node)
    return {"lcom4": fact["lcom4"], "temp_fields": len(fact["temporary"])}


def module_cycles(trees: dict[str, ast.Module]) -> dict[str, int]:
    """rel -> the size of the import cycle the module is in, 0 for none."""
    size = {name: len(comp) for comp in cycles(edges(trees)) for name in comp}
    return {rel: size.get(module_name(rel), 0) for rel in trees}
