"""`python3 -m synthesis [workspace]`: the A1 synthesis stage command (default workspace: cwd).

The checkpoint comes from `CW_CHECKPOINT`, which the stage agent sets.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from prflow.ratchet import run_codewatch as run_codewatch_in

from .inputs import run_codewatch
from .stage import run_stage
from .taste import call_claude


def main(argv: list[str]) -> int:
    workspace = Path(argv[0] if argv else ".").resolve()
    checkpoint = int(os.environ.get("CW_CHECKPOINT", "1"))
    report = run_stage(workspace, checkpoint, run_codewatch, call_claude, run_codewatch_in)
    print(json.dumps(report))
    return 1 if report["outcome"] == "model_failed" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
