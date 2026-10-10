"""`python -m prflow <stage>`: the PR-flow stage commands; prints the stage report as its last line.

Stages: `repo-init`, `pr-open` and `commit-ratchet`. `pr-merge` merges the checked-out PR
branch into `main` for the stage that ends the PR (synthesis, as the merging job). The
checkpoint comes from `CW_CHECKPOINT`, which the stage agent sets.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .pr import merge_pr, pr_open, repo_init
from .ratchet import commit_ratchet, run_codewatch
from .repo import GitError, HiddenRepo, pr_branch

FAILED = ("failed", "skipped")


def run(stage: str, repo: HiddenRepo, checkpoint: int) -> dict:
    if stage == "repo-init":
        return repo_init(repo, run_codewatch)
    if stage == "pr-open":
        return pr_open(repo, checkpoint)
    if stage == "commit-ratchet":
        return commit_ratchet(repo, checkpoint, run_codewatch)
    return merge_pr(repo, f"Merge {pr_branch(checkpoint)} into main")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m prflow")
    parser.add_argument("stage", choices=("repo-init", "pr-open", "commit-ratchet", "pr-merge"))
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--checkpoint", type=int, default=int(os.environ.get("CW_CHECKPOINT", "1")))
    args = parser.parse_args(argv)
    try:
        report = run(args.stage, HiddenRepo.at(args.workspace), args.checkpoint)
    except GitError as error:
        report = {"outcome": "failed", "reason": str(error)}
    print(json.dumps(report))
    return 1 if report.get("outcome") in FAILED else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
