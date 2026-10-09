"""python3 -m analysis --a0 DIR --a1a DIR --a1 DIR --out DIR (run from bench/scbench)."""

from __future__ import annotations

import argparse
from pathlib import Path

from .analyse import analyse
from .inputs import RerunSettings, run_scb_check
from .report import write_reports

DEFAULT_SCRATCH = Path.home() / ".cache" / "scbench-analysis"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SCBench A0 / A1a / A1 pilot analysis")
    parser.add_argument("--a0", type=Path, required=True, help="A0 run directory, after slop-code eval")
    parser.add_argument("--a1a", type=Path, required=True, help="A1a run directory")
    parser.add_argument("--a1", type=Path, required=True, help="A1 run directory")
    parser.add_argument("--a0-replicate", type=Path, help="optional A0' run for the noise floor")
    parser.add_argument(
        "--tests-dir",
        action="append",
        help="workspace-relative directory of the agent's tests (repeatable; default tests)",
    )
    parser.add_argument("--scratch", type=Path, default=DEFAULT_SCRATCH, help="snapshot copies go here")
    parser.add_argument(
        "--skip-sensitivity", action="store_true", help="do not re-run scb-check without the tests"
    )
    parser.add_argument("--out", type=Path, required=True, help="where report.md/json go")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None, scb_check=run_scb_check) -> int:
    args = parse_args(argv)
    rerun = None
    if not args.skip_sensitivity:
        rerun = RerunSettings(tuple(args.tests_dir or ["tests"]), args.scratch, scb_check)
    analysis = analyse({"A0": args.a0, "A1a": args.a1a, "A1": args.a1}, rerun, args.a0_replicate)
    write_reports(analysis, args.out)
    print(f"{analysis.decision.verdict}: {args.out / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
