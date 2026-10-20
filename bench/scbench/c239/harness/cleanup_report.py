"""cleanup_report.py <before tree> <after tree> [--json OUT]: the cleanup stage's complexity report.

Dilution-proof numbers (dilution.py, scb-check 0.1.3 compatible, no scb-check run) before -> after,
for the whole tree and for the functions the change touched, then erosion as a legacy line, then
nesting depth and defensive-check density as report lines only. Halstead, MI and single-caller
counts are not reported.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dilution import compare

SCOPE = "scb-compatible CC, source files with the tests dir excluded; before -> after"


def change(before: float, after: float, fmt: str = "g") -> str:
    pct = f" ({(after - before) / before:+.0%})" if before else ""
    return f"{before:{fmt}} -> {after:{fmt}}{pct}"


def complexity_line(label: str, before: dict, after: dict) -> str:
    return (f"[{label}] high-CC mass {change(before['mass'], after['mass'], '.1f')}; "
            f"CC>10 count {change(before['count'], after['count'])}; max CC {change(before['max'], after['max'])}; "
            f"total CC {change(before['total'], after['total'])}")


def render(numbers: dict) -> str:
    (tb, ta), (cb, ca), (lb, la) = numbers["tree"], numbers["touched"], numbers["lines"]
    n = len(numbers["touched_functions"])
    return "\n".join([
        f"cleanup report ({SCOPE})",
        complexity_line("tree", tb, ta),
        complexity_line(f"touched, {n} function{'s' * (n != 1)}", cb, ca),
        f"[legacy] erosion (reported for comparability): {tb['erosion']:.3f} -> {ta['erosion']:.3f}",
        f"[report] max nesting depth {lb['nesting_max']} -> {la['nesting_max']}; defensive checks per 100 SLOC "
        f"{lb['defensive_per_100']:.2f} -> {la['defensive_per_100']:.2f}. Report lines, not task types.",
    ])


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="cleanup_report.py")
    p.add_argument("before")
    p.add_argument("after")
    p.add_argument("--json")
    args = p.parse_args(argv)
    numbers = compare(Path(args.before), Path(args.after))
    if args.json:
        Path(args.json).write_text(json.dumps(numbers, indent=1) + "\n")
    print(render(numbers))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
