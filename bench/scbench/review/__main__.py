"""`python -m review [--spec FILE] [--mode fix|expected-output] <sha>`: the U17 review command.

Prints the report as its last stdout line and exits 0, or exits 1 with the reason on
stderr; the fix stage's hook records a failure as verdict `error`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from synthesis.taste import DEFAULT_MODEL, call_claude_no_tools

from .stage import Request, review
from .verdict import EXPECTED_OUTPUT, FIX, SYSTEM_PROMPT


def parse_args(argv: list[str]) -> Request:
    p = argparse.ArgumentParser(prog="python -m review")
    p.add_argument("sha", help="the commit to review, in the repository GIT_DIR names")
    p.add_argument("--spec", default=os.environ.get("CW_SPEC_FILE"),
                   help="checkpoint spec file outside the workspace (default: $CW_SPEC_FILE)")
    p.add_argument("--mode", choices=(FIX, EXPECTED_OUTPUT), default=FIX,
                   help="fix: the whole commit; expected-output: snapshot, golden and assertion edits only")
    p.add_argument("--workspace", default=".", help="the work tree holding NOTES.md (default: cwd)")
    p.add_argument("--tests-dir", default="tests")
    a = p.parse_args(argv)
    if not a.spec:
        p.error("--spec or CW_SPEC_FILE is required")
    return Request(a.sha, Path(a.spec), Path(a.workspace).resolve(), a.mode, a.tests_dir)


def call_model(prompt: str):
    return call_claude_no_tools(prompt, os.environ.get("CW_REVIEW_MODEL", DEFAULT_MODEL), SYSTEM_PROMPT)


def main(argv: list[str]) -> int:
    request = parse_args(argv)
    try:
        report = review(request, call_model)
    except Exception as error:  # noqa: BLE001 - any failure reaches the hook as an error verdict
        print(f"review: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
