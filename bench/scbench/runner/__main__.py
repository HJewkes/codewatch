"""python3 -m runner <frozen tree> --problem P --checkpoint N --out DIR [--label L] [--only ID,...]
                   [--max-usd X] [--turns T] [--apply]
One cleanup run on a copy of the frozen checkpoint-N tree (C-248 S6). Writes <out>/run.json (waves,
sessions, splice, integration checks) and <out>/ledger.jsonl. The specs are read from the problem's
checkpoint_1..N.md; the holdout guard refuses a sealed problem (exit 3). --only restricts the run to
the named task ids; --max-usd is the run's dollar backstop (tasks past it are skipped). --apply writes the
final tree back over the frozen one, as the A1 `fix` stage runs it on /workspace (C-248 S7).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from gate.t3 import call_reviewer
from regrade.holdout import MILESTONE_ENV, REFUSED_EXIT, HoldoutRefused, check

from runner import container
from runner.run import Run, execute
from runner.splice import changed_files, tree_files

PROBLEMS = Path.home() / ".cache" / "scbench" / "problems"


class ContainerSteps:
    """The real side effects: A1 containers for sessions, tests and diffgate; claude -p for T3."""

    review = staticmethod(call_reviewer)

    def __init__(self, problem: str, n: int, out: Path, turns: int):
        self.problem, self.n, self.turns = problem, n, turns
        self.lib = container.gate_lib(out / "gate-lib")

    def workspace(self, src: Path, dst: Path) -> Path:
        return container.copy_tree(src, dst)

    def session(self, name: str, ws: Path, text: str, gate: Path, base: Path, out: Path) -> dict:
        return container.session(name, ws, text, gate, base, self.lib, out, self.turns)

    def visible(self, ws: Path, out: Path) -> dict:
        return container.visible(ws, out)

    def diffgate(self, base: Path, head: Path, out: Path) -> dict:
        return container.diffgate(self.problem, self.n, base, head, out)

    def integration(self, base: Path, tree: Path, out: Path) -> dict:
        visible, dg = self.visible(tree, out), self.diffgate(base, tree, out)
        return {"pass": bool(visible["pass"] and dg.get("pass")), "visible": visible["pass"], "diffgate": dg.get("pass")}


def apply(frozen: Path, final: Path) -> list[str]:
    """Make the frozen tree's files (outside SKIP) those of the final tree; -> the paths changed."""
    before, after = tree_files(frozen), tree_files(final)
    changed = changed_files(before, after)
    for rel in changed:
        path = frozen / rel
        if rel in after:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(after[rel])
        else:
            path.unlink()
    return changed


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python3 -m runner")
    p.add_argument("frozen", type=Path)
    p.add_argument("--problem", required=True)
    p.add_argument("--checkpoint", type=int, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--label", default="")
    p.add_argument("--only")
    p.add_argument("--max-usd", type=float, default=7.0)
    p.add_argument("--turns", type=int, default=40)
    p.add_argument("--apply", action="store_true")
    a = p.parse_args(argv)
    try:
        check([a.problem], os.environ.get(MILESTONE_ENV))
    except HoldoutRefused as refusal:
        print(f"holdout guard: {refusal}", file=sys.stderr)
        return REFUSED_EXIT
    specs = [(PROBLEMS / a.problem / f"checkpoint_{k}.md").read_text() for k in range(1, a.checkpoint + 1)]
    a.out.mkdir(parents=True, exist_ok=True)
    run = Run(a.label or a.problem, a.out, specs, set(a.only.split(",")) if a.only else None, a.max_usd)
    summary = execute(run, ContainerSteps(a.problem, a.checkpoint, a.out, a.turns), a.frozen)
    applied = apply(a.frozen, Path(summary["final_tree"])) if a.apply else []
    print(json.dumps({"run": summary["run"], "usd": summary["usd"], "waves": len(summary["waves"]), "applied": applied}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
