"""Source clones: jscpd over the workspace's source and tests, as `clone` findings.

jscpd runs with the config pinned beside this file (`jscpd.json`: min-tokens 60, the JSON
reporter) and writes its report outside the workspace. Each duplicate pair becomes one
row on the copy that sorts later by path and line. Its evidence names the other copy as
`<path>:<start>-<end>`, which is what `codewatch triage`'s clone question reads.

    python3 -m findings.clones --workspace <dir> --out <file>
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from findings.rows import finding_row, print_summary, write_findings

SIGNAL = "clone"
CONFIG = Path(__file__).with_name("jscpd.json")
DEFAULT_JSCPD = "/opt/codewatch-a1/bin/jscpd"
REPORT_NAME = "jscpd-report.json"

Copy = tuple[str, int, int]


def read_report(path: Path) -> list[dict]:
    return json.loads(path.read_text()).get("duplicates", [])


def clone_rows(duplicates: list[dict]) -> list[dict]:
    rows = [_row(*sorted((_copy(d["firstFile"]), _copy(d["secondFile"])))) for d in duplicates]
    return sorted(rows, key=lambda r: (r["path"], r["lineStart"], r["evidence"]))


def _copy(file: dict) -> Copy:
    return Path(file["name"]).as_posix(), int(file["start"]), int(file["end"])


def _row(other: Copy, flagged: Copy) -> dict:
    path, start, end = flagged
    evidence = f"duplicates {other[0]}:{other[1]}-{other[2]}"
    return finding_row("jscpd", SIGNAL, path, (start, end), evidence)


def run_jscpd(workspace: Path, jscpd_bin: str, scratch: Path) -> Path | None:
    """Runs jscpd from the workspace so report paths are relative to it."""
    scratch.mkdir(parents=True, exist_ok=True)
    command = [jscpd_bin, "--config", str(CONFIG), "--output", str(scratch), "--no-tips", "."]
    subprocess.run(command, cwd=workspace, stdout=sys.stderr, check=False)
    report = scratch / REPORT_NAME
    return report if report.is_file() else None


def main(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    report = Path(args.report) if args.report else run_jscpd(
        Path(args.workspace), args.jscpd, Path(args.out).parent / "jscpd"
    )
    duplicates = read_report(report) if report else []
    rows = clone_rows(duplicates)
    write_findings(Path(args.out), rows)
    print_summary(items_in=len(duplicates), items_out=len(rows), jscpd_report=report is not None)
    return 0


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="findings.clones", description=__doc__.splitlines()[0])
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--report", help="an existing jscpd JSON report; skips the jscpd run")
    parser.add_argument("--jscpd", default=DEFAULT_JSCPD, help="jscpd executable")
    parser.add_argument("--out", required=True, help="findings.jsonl to write")
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
