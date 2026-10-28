"""C-264 S3: one JSON row per arm, problem and checkpoint, from the replay's output directory.

Reads `replay/<arm>/<problem>/` (`replay.json`, `ws/`, `trees/cpN`), `eval/<arm>/<problem>/cpN/
summary.json` from `eval.sh`, and `ctx/<arm>/<problem>/contexts.json` from `metrics contexts`.

    python3 -m c264.summary OUT > rows.json
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from remediation.admission import test_names
from remediation.git import Git

from .metrics import m1, m2_m3
from .replay import ARMS


def gate_counts(items: list[dict]) -> dict:
    gated = [i for i in items if "admitted" in i]
    by_signal: Counter[str] = Counter()
    for item in gated:
        by_signal[f"{item['signal']} admitted"] += len(item["admitted"])
        by_signal[f"{item['signal']} rejected"] += len(item["rejected"])
    return {"admitted": sum(len(i["admitted"]) for i in gated), "rejected": sum(len(i["rejected"]) for i in gated),
            "errors": sum(1 for i in gated if i["error"]), "gate_seconds": round(sum(i["gate_seconds"] for i in gated)),
            "statuses": dict(Counter(i["status"] for i in items)), "by_signal": dict(by_signal)}


def hidden(out: Path, arm: str, problem: str, cp: int) -> str | None:
    path = out / "eval" / arm / problem / f"cp{cp}" / "summary.json"
    if not path.is_file():
        return None
    result = json.loads(path.read_text())
    return f"{result['passed']}/{result['total']}"


def survives(tree: Path, context: str) -> bool:
    """Whether the test a `test_function` context names (`module.Class.test`) is in `tree`."""
    module, _, name = context.partition(".")
    file = tree / "tests" / f"{module}.py"
    return file.is_file() and name.replace(".", "::") in test_names(file.read_text(encoding="utf-8"))


def cp5_coverage(out: Path, arm: str, problem: str, tree: Path) -> dict:
    own = out / "ctx" / arm / problem / "contexts.json"
    reference = out / "ctx" / "R-none" / problem / "contexts.json"
    row = {}
    if own.is_file():
        shape = json.loads(own.read_text())
        row |= {"coverage_identical": shape["coverage_identical"], "unique_line_tests": len(shape["unique_line_tests"])}
    if reference.is_file():
        unique = json.loads(reference.read_text())["unique_line_tests"]
        row["r_none_unique_kept"] = f"{sum(survives(tree, c) for c in unique)}/{len(unique)}"
    return row


def rows_for(out: Path, arm: str, problem: str) -> list[dict]:
    run = out / "replay" / arm / problem
    items = json.loads((run / "replay.json").read_text())["items"]
    git = Git(run / "ws", run / "ws" / ".codewatch" / "repo.git")
    rows = []
    for tree in sorted((run / "trees").iterdir(), key=lambda p: int(p.name.removeprefix("cp"))):
        cp = int(tree.name.removeprefix("cp"))
        row = {"arm": arm, "problem": problem, "cp": cp, **m1(git, tree.name, tree), **m2_m3(tree),
               **gate_counts([i for i in items if i["cp"] == cp]), "hidden": hidden(out, arm, problem, cp)}
        rows.append(row | (cp5_coverage(out, arm, problem, tree) if cp == 5 else {}))
    return rows


def main(argv: list[str] | None = None) -> int:
    out = Path((argv or sys.argv[1:])[0])
    rows = [row for arm in ARMS for problem in sorted(p.name for p in (out / "replay" / arm).iterdir())
            for row in rows_for(out, arm, problem)]
    print(json.dumps(rows, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
