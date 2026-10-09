"""`tiert ROOT [--out FILE] [--append]`: test-shape findings for a tree's pytest functions."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .findings import count_by_signal, scan


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tiert", description=__doc__)
    parser.add_argument("root", type=Path, help="tree to scan; row paths are relative to it")
    parser.add_argument("--out", type=Path, help="write rows here instead of stdout")
    parser.add_argument("--append", action="store_true", help="append to --out, e.g. codewatch audit's findings.jsonl")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.root.is_dir():
        print(f"tiert: {args.root} is not a directory", file=sys.stderr)
        return 2
    rows, tests = scan(args.root)
    lines = "".join(f"{json.dumps(r)}\n" for r in rows)
    summary = json.dumps({"items_in": tests, "items_out": len(rows), "signals": count_by_signal(rows)})
    if args.out is None:
        sys.stdout.write(lines)
        print(summary, file=sys.stderr)
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("a" if args.append else "w", encoding="utf-8") as out:
        out.write(lines)
    print(summary)
    return 0
