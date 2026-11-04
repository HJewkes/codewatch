"""python3 -m runner <frozen tree> --problem P --checkpoint N --out DIR [--label L] [--only ID,...]
                   [--max-usd X] [--turns T] [--max-load L] [--apply]
One cleanup run on a copy of the frozen checkpoint-N tree (C-248 S6). Writes <out>/run.json (waves,
sessions, splice, integration checks) and <out>/ledger.jsonl. The specs are read from the problem's
checkpoint_1..N.md; the holdout guard refuses a sealed problem (exit 3). --only restricts the run to
the named task ids; --max-usd is the run's dollar cap: a session or retry starts only while the spend plus
the sessions in flight, at a per-session estimate, is below it, so a run ends about one session past it at
most. --apply writes the final tree back over the frozen one, as a candidate A1 `fix` stage would on /workspace (C-248 S7). --max-load holds
each session until the host's 5-minute load average is below L.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
import time
from pathlib import Path

from gate.t3 import call_reviewer
from regrade.holdout import MILESTONE_ENV, REFUSED_EXIT, HoldoutRefused, check

from runner import container
from runner.run import Run, execute
from runner.splice import changed_files, tree_files

WORK_FD_ENV = "AR_WORK_FD"
WORK_MARKER = b"ar-work-started\n"
PROBLEMS = Path.home() / ".cache" / "scbench" / "problems"


class ContainerSteps:
    """The real side effects: A1 containers for sessions, tests and diffgate; claude -p for T3."""

    review = staticmethod(call_reviewer)

    def __init__(self, problem: str, n: int, out: Path, turns: int, max_load: float | None = None):
        self.problem, self.n, self.turns, self.max_load = problem, n, turns, max_load
        self.lib = container.gate_lib(out / "gate-lib")
        self._marked, self._mark_lock = False, threading.Lock()

    def _mark_work_started(self) -> None:
        """Once, tell the eval's caller that the load wait is over: the marker goes to the fd named by AR_WORK_FD."""
        fd = os.environ.get(WORK_FD_ENV)
        with self._mark_lock:
            if self._marked:
                return
            self._marked = True
            if fd:
                os.write(int(fd), WORK_MARKER)

    def workspace(self, src: Path, dst: Path) -> Path:
        return container.copy_tree(src, dst)

    def session(self, name: str, ws: Path, text: str, gate: Path, base: Path, out: Path) -> dict:
        while self.max_load is not None and os.getloadavg()[1] >= self.max_load:
            time.sleep(60)
        self._mark_work_started()
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


def usd_cap(text: str) -> float:
    """A dollar cap, or `none` for no per-run cap (the spend is still recorded)."""
    return math.inf if text == "none" else float(text)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python3 -m runner")
    p.add_argument("frozen", type=Path)
    p.add_argument("--problem", required=True)
    p.add_argument("--checkpoint", type=int, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--label", default="")
    p.add_argument("--only")
    p.add_argument("--max-usd", type=usd_cap, default=7.0)
    p.add_argument("--turns", type=int, default=40)
    p.add_argument("--max-load", type=float)
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
    summary = execute(run, ContainerSteps(a.problem, a.checkpoint, a.out, a.turns, a.max_load), a.frozen)
    applied = apply(a.frozen, Path(summary["final_tree"])) if a.apply else []
    print(json.dumps({"run": summary["run"], "usd": summary["usd"], "waves": len(summary["waves"]), "applied": applied}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
