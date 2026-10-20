"""python3 -m regrade --problem P --checkpoint N --base DIR --head DIR --out FILE (from bench/scbench)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from analysis.inputs import run_scb_check

from . import holdout
from .grade import Graders, bench_hidden_eval, recorded_score, regrade, table_row

DEFAULT_SCRATCH = Path.home() / ".cache" / "scbench-regrade"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="regrade", description=__doc__)
    parser.add_argument("--problem", required=True)
    parser.add_argument("--checkpoint", type=int, required=True)
    parser.add_argument("--base", type=Path, required=True, help="seed checkpoint_N/ dir or a plain tree")
    parser.add_argument("--head", type=Path, required=True, help="the modified tree")
    parser.add_argument("--out", type=Path, required=True, help="result JSON")
    parser.add_argument("--label", help="first cell of the table row (default: head dir name)")
    parser.add_argument("--recorded", type=Path, help="the run's checkpoint_results.jsonl, for parity")
    parser.add_argument("--tests-dir", action="append", help="tests directory to exclude (default: tests)")
    parser.add_argument("--scratch", type=Path, default=DEFAULT_SCRATCH)
    parser.add_argument("--skip-eval", action="store_true", help="scb-check only, no hidden tests")
    return parser


def _check_holdout(problem: str) -> None:
    holdout.check([problem], os.environ.get(holdout.MILESTONE_ENV))


def main(argv: list[str] | None = None, scb_check=run_scb_check, hidden_eval=None,
         holdout_check=_check_holdout) -> int:
    args = _parser().parse_args(argv)
    try:
        holdout_check(args.problem)
    except holdout.HoldoutRefused as refusal:
        print(f"regrade: {refusal}", file=sys.stderr)
        return holdout.REFUSED_EXIT
    if hidden_eval is None and not args.skip_eval:
        hidden_eval = bench_hidden_eval(args.problem, args.checkpoint)
    graders = Graders(scb_check, hidden_eval, tuple(args.tests_dir or ["tests"]))
    recorded = recorded_score(args.recorded, args.problem, args.checkpoint) if args.recorded else None
    result = regrade(args.base, args.head, graders, args.scratch, recorded)
    result.update(problem=args.problem, checkpoint=args.checkpoint)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=1) + "\n")
    print(table_row(args.label or args.head.name, result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
