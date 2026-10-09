"""python3 -m analysis --a0 DIR --a1a DIR --a1 DIR --out DIR (run from bench/scbench)."""

from __future__ import annotations

import argparse
from pathlib import Path

from .analyse import analyse
from .report import write_reports


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SCBench A0 / A1a / A1 pilot analysis")
    parser.add_argument("--a0", type=Path, required=True, help="A0 eval output directory")
    parser.add_argument("--a1a", type=Path, required=True, help="A1a eval output directory")
    parser.add_argument("--a1", type=Path, required=True, help="A1 eval output directory")
    parser.add_argument("--a0-replicate", type=Path, help="optional A0' run for the noise floor")
    parser.add_argument(
        "--tests-dir",
        action="append",
        help="workspace-relative directory of the agent's tests (repeatable; default tests)",
    )
    parser.add_argument("--out", type=Path, required=True, help="where report.md/json go")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    analysis = analyse(
        {"A0": args.a0, "A1a": args.a1a, "A1": args.a1},
        tuple(args.tests_dir or ["tests"]),
        args.a0_replicate,
    )
    write_reports(analysis, args.out)
    print(f"{analysis.decision.verdict}: {args.out / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
