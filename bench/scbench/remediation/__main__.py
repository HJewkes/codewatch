"""Entry point for the `remediation` stage command; prints the stage report as its last line."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import sys
from pathlib import Path

from .session import run_process
from .stage import Config, remediate

DEFAULT_CODEWATCH = "/usr/local/bin/codewatch"
DEFAULT_TESTS = "python -m pytest -q tests"


def parse_args(argv: list[str]) -> Config:
    parser = argparse.ArgumentParser(prog="python -m remediation")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--scratch", type=Path, default=Path.home() / ".cache" / "codewatch-remediation")
    parser.add_argument("--codewatch", default=DEFAULT_CODEWATCH)
    parser.add_argument("--test-command", default=DEFAULT_TESTS)
    parser.add_argument("--replay-command", default=None, help="prints {\"diffs\": [...]}; absent until U3")
    parser.add_argument("--session-timeout", type=float, default=15 * 60)
    parser.add_argument("--tool-timeout", type=float, default=5 * 60)
    args = parser.parse_args(argv)
    return Config(
        workspace=args.workspace.resolve(), scratch=args.scratch, codewatch=args.codewatch,
        test_command=shlex.split(args.test_command),
        replay_command=shlex.split(args.replay_command) if args.replay_command else None,
        session_timeout=args.session_timeout, tool_timeout=args.tool_timeout,
    )


def main(argv: list[str]) -> int:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    config = parse_args(argv)
    report = remediate(config, dict(os.environ), run_process, run_process)
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
