"""Synthetic trees and fake side effects for the S6 runner tests (no container, no model).

The tree is one module of dispatch ladders: each `calc_<x>` is a hot function whose 12-arm if/elif
ladder a lane turns into a table lookup (no new function, so the final gate can accept it), ending in
an error message the specs want verbatim.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from planner import plan_tree
from planner.template import render
from runner.splice import changed_files, tree_files

BENCH = Path(__file__).resolve().parent.parent
ARMS = 12
MESSAGE = "error: unknown op "
GREEN = {"pass": True, "failed": []}


def ladder(name: str, message: str = MESSAGE) -> str:
    arms = "".join(f"    {'if' if i == 0 else 'elif'} op == 'k{i}':\n        return x + {i}\n" for i in range(ARMS))
    return f"def {name}(op, x):\n{arms}    raise ValueError({message!r} + op)\n"


def table(name: str, message: str = MESSAGE) -> str:
    keys = ", ".join(f"'k{i}': {i}" for i in range(ARMS))
    return (f"def {name}(op, x):\n    steps = {{{keys}}}\n    if op in steps:\n        return x + steps[op]\n"
            f"    raise ValueError({message!r} + op)\n")


def module(names: list[str], tabled: dict[str, str] | None = None) -> str:
    """The module with each name a ladder, or the table form for names in `tabled` (name -> message)."""
    tabled = tabled or {}
    return "\n\n".join(table(n, tabled[n]) if n in tabled else ladder(n) for n in names)


def write_app(root: Path, source: str) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "app.py").write_text(source)
    return root


def set_function(ws: Path, name: str, text: str) -> None:
    """Replace one top-level function of app.py with `text`."""
    source = (ws / "app.py").read_text()
    blocks = source.split("\n\n")
    for i, block in enumerate(blocks):
        if block.lstrip("\n").startswith(f"def {name}("):
            lead = block[:len(block) - len(block.lstrip("\n"))]
            blocks[i] = lead + text.rstrip("\n") + ("\n" if block.endswith("\n") else "")
    (ws / "app.py").write_text("\n\n".join(blocks))


def chosen_planner(root: Path, cfg: dict, label: str) -> dict:
    """The real plan, with an R1 edit chosen on each task (the planner's floor rejects these toy ladders)."""
    plan = plan_tree(root, cfg=cfg, label=label)
    for task in plan["tasks"]:
        edit = {"id": "e1", "recipe": "R1", "unit": task["id"], "span": [1, 2 + 2 * ARMS], "arms": ARMS,
                "params": ["x"], "rejected": []}
        task["candidates"] = [edit]
        task["chosen"] = {"edits": ["e1"], "gain": 10.0, "touches": [task["id"]], "families": {"iface_budget": 0.05}}
        task["template"] = render(task, cfg, label, len(plan["waves"]))
    return plan


def run_case(root: Path, code: str) -> str:
    done = subprocess.run([sys.executable, "-I", "-B", "-c", f"import sys; sys.path.insert(0, '.'); {code}"],
                          cwd=root, capture_output=True, text=True, check=False)
    return (done.stderr.strip().splitlines() or [""])[-1]


class FakeSteps:
    """Scripted sessions ({task id: [edit per attempt]}), diffgate by running `cases` on base and head,
    and an integration gate that fails while any spliced file contains `poison`."""

    def __init__(self, script: dict | None = None, cases: list[str] = (), poison: str | None = None, usd: float = 0.01):
        self.script, self.cases, self.poison, self.usd = script or {}, list(cases), poison, usd
        self.prompts: dict[str, list[str]] = {}

    @staticmethod
    def review(prompt: str):
        raise RuntimeError("no reviewer in the fixtures")

    def workspace(self, src: Path, dst: Path) -> Path:
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__"))
        return dst

    def session(self, name: str, ws: Path, text: str, gate: Path, base: Path, out: Path) -> dict:
        task = next(t for t in self.script if f"--cluster {t}" in text)
        self.prompts.setdefault(task, []).append(text)
        before = tree_files(ws)
        self.script[task][len(self.prompts[task]) - 1](ws, gate)
        return {"usd": self.usd, "tree_changed": bool(changed_files(before, tree_files(ws)))}

    def visible(self, ws: Path, out: Path) -> dict:
        return GREEN

    def diffgate(self, base: Path, head: Path, out: Path) -> dict:
        found = [{"case": code, "status": "differs", "fields": ["stderr"], "base": {"stderr": b}, "head": {"stderr": h}}
                 for code in self.cases if (b := run_case(base, code)) != (h := run_case(head, code))]
        return {"pass": not found, "differences": found}

    def integration(self, base: Path, tree: Path, out: Path) -> dict:
        text = "".join(v.decode() for v in tree_files(tree).values())
        return {"pass": self.poison is None or self.poison not in text}


def gate_env(gate: Path) -> dict:
    return {**os.environ, "CW_GATE_LIB": str(BENCH), "CW_GATE_BASE": str(gate.parent.parent.parent / "base"),
            "CW_GATE_PLAN": str(gate / "plan.json"), "CW_GATE_CALLS": str(gate / "calls.json"),
            "CW_GATE_REFUSED": str(gate / "refused")}
