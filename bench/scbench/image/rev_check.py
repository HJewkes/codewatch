"""Checks the report `rev-check.sh` writes: `{"rev": <graph index --rev HEAD~1 --json>, "head": <... --rev HEAD>}`.

HEAD adds one function, `rev_check_marker`, to the fixture. An index that read HEAD~1 has at
least one file and fewer nodes than the index of HEAD; one that read HEAD or the working tree
by mistake has as many.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def problem(report: dict) -> str | None:
    rev, head = report["rev"], report["head"]
    if rev["files"] < 1:
        return "graph index --rev HEAD~1 indexed no files"
    if rev["nodes"] >= head["nodes"]:
        return (f"graph index --rev HEAD~1 has {rev['nodes']} nodes, not fewer than HEAD's {head['nodes']}: "
                "it read rev_check_marker, so it did not read HEAD~1")
    return None


def main(argv: list[str]) -> int:
    found = problem(json.loads(Path(argv[0]).read_text()))
    if found:
        print(f"rev_check: {found}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
