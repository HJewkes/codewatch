"""Entry point for the fix stage command; prints the stage report as its last line.

No flag caps the work by default: `--max-items` and `--max-turns` are opt-in. The stage
stops only at `CW_DEADLINE`, the stage deadline the agent passes in, less
`--reset-margin` seconds kept for the consistency reset.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import sys
from pathlib import Path

from .fixer import Clock
from .git import DEFAULT_GIT_DIR
from .session import run_process
from .stage import Config, remediate

DEFAULT_CODEWATCH = "/usr/local/bin/codewatch"


def parse_args(argv: list[str], env: dict[str, str]) -> Config:
    p = argparse.ArgumentParser(prog="python -m remediation")
    p.add_argument("--workspace", type=Path, default=Path.cwd())
    p.add_argument("--scratch", type=Path, default=Path.home() / ".cache" / "codewatch-remediation")
    p.add_argument("--git-dir", type=Path, default=None, help=f"default <workspace>/{DEFAULT_GIT_DIR}")
    p.add_argument("--codewatch", default=DEFAULT_CODEWATCH)
    p.add_argument("--db", default=".codewatch/cache/graph.db")
    p.add_argument("--check-config", default=".codewatch/check.json")
    p.add_argument("--baseline", default=None, help="merge-base snapshot id or ref; default: index it here")
    p.add_argument("--tests-dir", default="tests")
    p.add_argument("--test-command", default=None, help="default: python -m pytest -q <tests dir>")
    p.add_argument("--review-command", default=None, help="U17 hook: gets the commit sha, prints a verdict")
    p.add_argument("--deadline", type=float, default=float(env["CW_DEADLINE"]) if env.get("CW_DEADLINE") else None)
    p.add_argument("--reset-margin", type=float, default=180.0)
    p.add_argument("--max-items", type=int, default=None)
    p.add_argument("--max-turns", type=int, default=None)
    a = p.parse_args(argv)
    workspace = a.workspace.resolve()
    return Config(
        workspace=workspace, scratch=a.scratch, git_dir=(a.git_dir or workspace / DEFAULT_GIT_DIR).resolve(),
        codewatch=a.codewatch, db=a.db, check_config=a.check_config, baseline=a.baseline,
        tests_dir=a.tests_dir, test_command=shlex.split(a.test_command or f"python -m pytest -q {a.tests_dir}"),
        review_command=shlex.split(a.review_command) if a.review_command else None,
        deadline=a.deadline, reset_margin=a.reset_margin, max_items=a.max_items, max_turns=a.max_turns,
    )


def main(argv: list[str]) -> int:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    config = parse_args(argv, env)
    clock = Clock(config.deadline, config.reset_margin)
    print(json.dumps(remediate(config, env, run_process, run_process, clock)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
