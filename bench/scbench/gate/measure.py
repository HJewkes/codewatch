"""What the gates measure in a change: a frozen base tree against a head tree, unit by unit (C-248 S4).

  modules      source files (dilution.py's walk, tests left out) whose text differs
  touched      per module, the units whose AST differs (B8.6: a renamed unit is removed plus added), and
               the removed and added units; `new` are the added ones
  t1           own-body CC added over the touched set, against the new-function count (+ t1_margin)
  families     P5's verdict (planner/families.py) over every touched unit, module and class at once
  constraints  S3b's detectors (planner/endstate.py) over the touched set: each counted kind the end
               state has more of, with its new findings as evidence; classes over the LCOM4 limit or with
               new temporary fields; new hidden calls (getattr, eval, exec); and new import cycles and
               SDP breaks over the whole tree
  gain         own-body high-CC mass removed
"""

from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path

from planner import endstate
from planner.families import profile, verdict
from planner.modules import structure, violations
from planner.units import dilution, own_nodes

KINDS = {"common": "common coupling", "origins": "new flag origins", "pass_through": "pass-through",
         "unused": "unused params/locals"}
HIDDEN_CALLS = {"getattr", "eval", "exec", "globals", "locals", "__import__"}


def sources(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): p.read_text(errors="replace") for p in dilution.source_files(root)}


def _parse(rel: str, text: str) -> ast.Module:
    try:
        return ast.parse(text)
    except (SyntaxError, ValueError) as error:
        raise ValueError(f"{rel} does not parse: {error}") from error


def _touched(before: endstate.State, after: endstate.State) -> tuple[set[str], set[str], list[str]]:
    both = set(before.units) & set(after.units)
    changed = {k for k in both if ast.dump(before.units[k].node) != ast.dump(after.units[k].node)}
    new = sorted(set(after.units) - set(before.units))
    return changed | (set(before.units) - set(after.units)), changed | set(new), new


def _findings(state: endstate.State, keys: set[str], kind: str) -> Counter:
    return Counter(f"{state.units[k].qual}: {f}" for k in keys for f in state.found.get(k, {}).get(kind, []))


def _hidden(state: endstate.State, keys: set[str]) -> Counter:
    calls = (f"{state.units[k].qual}: {n.func.id}()" for k in keys for n in own_nodes(state.units[k].node)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in HIDDEN_CALLS)
    return Counter(calls)


def _grew(before: Counter, after: Counter) -> list[str]:
    return sorted((after - before).elements()) if sum(after.values()) > sum(before.values()) else []


class Change:
    """Accumulates one change's per-module measures into a whole-change result."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.rows = {"before": [], "after": []}
        self.cc = [0, 0]
        self.crossings = [0, 0]
        self.lines = {"before": {}, "after": {}}
        self.classes = {"before": {}, "after": {}}
        self.evidence: dict[str, list[str]] = {}
        self.touched = {"before": [], "after": []}
        self.new: list[str] = []
        self.mass = [0.0, 0.0]

    def add(self, rel: str, before: endstate.State, after: endstate.State) -> None:
        kb, ka, new = _touched(before, after)
        self.new += new
        self.touched["before"] += sorted(kb)
        self.touched["after"] += sorted(ka)
        for side, state, keys in (("before", before, kb), ("after", after, ka)):
            i = side == "after"
            self.rows[side] += [endstate.row(state.units[k]) for k in sorted(keys)]
            self.cc[i] += sum(state.units[k].cc for k in keys)
            self.crossings[i] += sum(len(state.found[k]["control"]) for k in keys if k in state.found)
            self.lines[side][rel] = state.sloc
            self.mass[i] += endstate.mass([state.units[k] for k in keys], self.cfg["hot_cc"])
        units = [before.units[k] for k in kb] + [after.units[k] for k in ka]
        for side, state in (("before", before), ("after", after)):
            self.classes[side].update({f"{rel}:{c}": r for c, r in endstate.class_rows(state, units).items()})
        self._constraints(before, after, kb, ka, units)

    def _constraints(self, before, after, kb, ka, units) -> None:
        for kind in KINDS:
            if found := _grew(_findings(before, kb, kind), _findings(after, ka, kind)):
                self.evidence.setdefault(kind, []).extend(found)
        if hidden := _grew(_hidden(before, kb), _hidden(after, ka)):
            self.evidence.setdefault("hidden_calls", []).extend(hidden)
        if broken := endstate.class_breaks(before, after, units, self.cfg["constraints"]["lcom4_max"]):
            self.evidence.setdefault("classes", []).extend(broken)

    def result(self) -> dict:
        n, margin = len(self.new), self.cfg["constraints"]["t1_margin"]
        grew = self.cc[1] - self.cc[0]
        change = {"crossings": self.crossings, "new_fns": n,
                  "modules": {**self.lines, "classes": self.classes}}
        fam = verdict(profile(self.rows["before"], self.cfg), profile(self.rows["after"], self.cfg), change, self.cfg)
        return {"new": sorted(self.new), "touched_before": self.touched["before"],
                "touched_after": self.touched["after"], "t1": {"cc_added": grew, "new_fns": n,
                                                               "pass": grew <= n + margin},
                "families": fam, "constraints": {k: sorted(v) for k, v in sorted(self.evidence.items())},
                "gain": round(self.mass[0] - self.mass[1], 1), "sloc": [sum(r["sloc"] for r in self.rows[s])
                                                                       for s in ("before", "after")]}


def _module_breaks(base: dict[str, ast.Module], head: dict[str, ast.Module], changed: list[str], cfg: dict) -> list[str]:
    if all(endstate.imports(base.get(r)) == endstate.imports(head.get(r)) for r in changed):
        return []
    found = violations(structure(base), structure(head), cfg["constraints"]["sdp_max_delta_i"])
    return [f"cycle: {' > '.join(c)}" for c in found["cycles"]] + [f"sdp: {s} > {d}" for s, d, _ in found["sdp"]]


def measure_trees(base: dict[str, str], head: dict[str, str], cfg: dict) -> dict:
    """The change from base to head, each given as {relative path: source text}."""
    changed = sorted(r for r in set(base) | set(head) if base.get(r) != head.get(r))
    trees = {side: {r: _parse(r, t) for r, t in texts.items()} for side, texts in (("base", base), ("head", head))}
    change = Change(cfg)
    for rel in changed:
        states = [endstate.measure(rel, trees[side].get(rel) or ast.Module(body=[], type_ignores=[]))
                  for side in ("base", "head")]
        change.add(rel, *states)
    if modules := _module_breaks(trees["base"], trees["head"], changed, cfg):
        change.evidence["modules"] = modules
    return {"modules": changed, **change.result()}


def measure_change(base: Path, head: Path, cfg: dict) -> dict:
    return measure_trees(sources(base), sources(head), cfg)
