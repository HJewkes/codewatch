"""The plan template (C-248 B8.2): what the implementer gets from codewatch, and nothing else.

It names the recipe and its shape rules, the owned, frozen and new symbols, the family to improve and the
families to hold in plain units with this task's numbers, one pass condition and the retry contract. It
never shows a score, a weight, the floor or the rank. A task with no feasible edit still renders, with
the recipe `none` and the reasons its best candidates were rejected.
"""

from __future__ import annotations

import json

RECIPES = {
    "R1": ("dispatch chain -> table", ["turn the if/elif ladder into a table of handlers keyed by its literals",
                                       "every handler takes the same parameters; the else arm stays in place"]),
    "R2": ("merge duplicated branches", ["give the two adjacent arms with identical bodies one combined test",
                                         "keep the order of every other arm"]),
    "R3": ("stage extraction", ["move each cut range into a stage that takes the cut's in-names and returns "
                                "its out-names", "the rest of the head stays in place",
                                "inside each stage, collapse conditions that become redundant once the stage "
                                "returns early, so the stage plus the head has fewer branches than the "
                                "original range"]),
    "R4": ("inline a trivial helper", ["put the helper's return expression at its one call site",
                                       "then delete the helper"]),
}


def _q(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _edit_lines(edit: dict) -> list[str]:
    line = f"  - {edit['recipe']} {edit['unit'].split(':', 1)[1]} lines {edit['span'][0]}-{edit['span'][1]}"
    if edit["recipe"] == "R3":
        line += f": in {_q(edit['in'])} out {_q(edit['out'])} (cut width {edit['width']})"
    elif edit["recipe"] == "R1":
        line += f": {edit['arms']} arms, handlers take {_q(edit['params'])}"
    elif edit["recipe"] == "R4":
        line += f": inline {edit['helper'].split(':', 1)[1]}"
    return [line]


def _recipe(task: dict, chosen: dict | None) -> list[str]:
    if not chosen:
        reasons = sorted({r for c in task["candidates"] for r in c["rejected"]}) or ["no candidate edit"]
        return ["recipe: none                                # leave this task as it is", f"reasons: {_q(reasons)}"]
    edits = [c for c in task["candidates"] if c["id"] in chosen["edits"]]
    recipes = sorted({e["recipe"] for e in edits})
    out = [f"recipe: {', '.join(f'{r} {RECIPES[r][0]}' for r in recipes)}", "shape:"]
    out += [f"  - {rule}" for r in recipes for rule in RECIPES[r][1]]
    return out + ["edits:"] + [line for e in edits for line in _edit_lines(e)]


def _hold(fam: dict | None, cfg: dict) -> list[str]:
    p5 = cfg["p5"]
    budget = f" (this task: +{fam['iface_budget']:.2f} per SLOC)" if fam else ""
    return ["hold:",
            f"  iface: \"interface risk may rise by at most half the complexity risk you remove{budget}\"",
            f"  crossings: \"+{p5['crossings']} flag parameter crossing at most; no new flag parameters\"",
            f"  module: \"about {p5['module_lines_per_new_function']} lines per new function\"",
            f"  amount: \"touched code may grow to at most {p5['amount_ratio']}x\""]


def render(task: dict, cfg: dict, label: str = "", waves: int = 0) -> str:
    head = task["id"].split(":", 1)[1]
    chosen = task.get("chosen")
    lines = [f"task: {label + '/' if label else ''}{task['id']}", f"wave: {task['wave']} of {waves}"]
    lines += _recipe(task, chosen)
    lines += [f"owned: {_q([r['key'] for r in task['owned']])}", f"frozen: {_q([f['key'] for f in task['frozen']])}",
              "head_signature: frozen", f"new_functions: place directly after {head}; names are yours",
              "improve: [cx]"]
    lines += _hold(chosen["families"] if chosen else None, cfg)
    lines += ["behaviour: all specs cp1..cpN hold; error messages verbatim",
              f"pass_condition: \"{head} and its helpers: cx improves, the holds hold, the visible tests pass\"",
              f"self_check: \"scbench gate --cluster {task['id']}   (advisory, at most 3 calls)\"",
              "retry: one, with one deterministic failure message"]
    return "\n".join(lines) + "\n"
