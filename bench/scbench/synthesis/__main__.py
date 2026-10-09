"""`python3 -m synthesis [workspace]`: the A1 synthesis stage command (default workspace: cwd)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .inputs import run_codewatch
from .rubric import call_claude
from .stage import run_stage


def main(argv: list[str]) -> int:
    workspace = Path(argv[0] if argv else ".").resolve()
    report = run_stage(workspace, run_codewatch, call_claude)
    print(json.dumps(report))
    return 1 if report["outcome"] == "model_failed" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
