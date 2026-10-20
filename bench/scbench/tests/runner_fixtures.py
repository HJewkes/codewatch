"""Synthetic trees and fake side effects for the S6 runner tests (no container, no model).

The tree is one module of dispatch ladders: each `calc_<x>` is a hot function whose 12-arm if/elif
ladder a lane turns into a table lookup, ending in an error message the specs want verbatim.
"""

from __future__ import annotations

from pathlib import Path

from runner.splice import tree_files

ARMS = 12
MESSAGE = "error: unknown op "


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


class FakeSteps:
    """An integration gate that fails while any spliced file contains `poison`."""

    def __init__(self, poison: str | None = None):
        self.poison = poison

    def integration(self, base: Path, tree: Path, out: Path) -> dict:
        text = "".join(v.decode() for v in tree_files(tree).values())
        return {"pass": self.poison is None or self.poison not in text}
