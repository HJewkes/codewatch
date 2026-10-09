"""Diff coverage: functions changed since a baseline that no test executes.

The caller supplies the baseline: an earlier snapshot directory (`--base-dir`) or a git
revision of the workspace (`--base-rev`), such as a PR's merge-base with main. A function
is changed when it is new or its source differs from the function of the same qualified
name in the baseline. It is uncovered when none of its body's executable lines ran.

Coverage comes from `coverage json` output: a file given with `--coverage-json`, or one
this script makes by running pytest under the pinned coverage.py. Test files are not
checked. Writes `findings.jsonl` rows with signal `diff-uncovered`. When the baseline
or the coverage report cannot be read, it writes no rows and exits 1, with `outcome`
`no-baseline` or `no-coverage` in the summary line.

Line coverage cannot tell a one-line function's body from its `def`, which runs at
import, so such functions always count as covered.

    python3 -m findings.diff_uncovered --workspace <dir> --base-rev <sha> --out <file>
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from findings.py_symbols import FunctionSpan, functions, source_files
from findings.rows import finding_row, print_summary, write_findings

SIGNAL = "diff-uncovered"
DEFAULT_COVERAGE = "/opt/codewatch-a1/bin/coverage"
# The tools' own output goes to the process's stderr, keeping stdout for the summary line.
STDERR_FD = 2
TESTS_RAN = (0, 1)

BaseReader = Callable[[str], str | None]


@dataclass(frozen=True)
class FileCoverage:
    executed: frozenset[int]
    executable: frozenset[int]


def read_coverage_json(path: Path, workspace: Path) -> dict[str, FileCoverage]:
    """Per-file line coverage keyed by POSIX path relative to the workspace."""
    files = json.loads(path.read_text()).get("files", {})
    root = workspace.resolve()
    result = {}
    for name, data in files.items():
        executed = frozenset(data.get("executed_lines", []))
        missing = frozenset(data.get("missing_lines", []))
        result[_relative(name, root)] = FileCoverage(executed, executed | missing)
    return result


def _relative(name: str, root: Path) -> str:
    path = Path(name)
    if path.is_absolute():
        path = Path(os.path.relpath(path.resolve(), root))
    return path.as_posix()


def changed_functions(current: str, base: str | None) -> list[FunctionSpan]:
    """A property's getter and setter, overloads and branch-defined functions share a
    name, so a function is unchanged when any baseline function of its name matches."""
    before: dict[str, set[str]] = {}
    for f in functions(base) if base is not None else []:
        before.setdefault(f.qualname, set()).add(f.source)
    return [f for f in functions(current) if f.source not in before.get(f.qualname, set())]


def is_uncovered(span: FunctionSpan, coverage: FileCoverage | None) -> bool:
    if coverage is None:
        return True
    body = set(range(span.body_start, span.end + 1))
    return bool(body & coverage.executable) and not body & coverage.executed


def diff_uncovered(
    workspace: Path, read_base: BaseReader, coverage: dict[str, FileCoverage]
) -> tuple[int, list[dict]]:
    """The number of changed functions, and a row for each one no test covers."""
    changed = 0
    rows = []
    for path in source_files(workspace):
        spans = changed_functions((workspace / path).read_text(errors="replace"), read_base(path))
        changed += len(spans)
        rows.extend(_row(path, s) for s in spans if is_uncovered(s, coverage.get(path)))
    return changed, rows


def _row(path: str, span: FunctionSpan) -> dict:
    evidence = f"{span.qualname} changed since the baseline and no test executes lines {span.body_start}-{span.end}"
    return finding_row("coverage", SIGNAL, path, (span.start, span.end), evidence, span.qualname)


def dir_base(base_dir: Path) -> BaseReader | None:
    """Reads an earlier snapshot, or None when there is no such directory."""
    if not base_dir.is_dir():
        return None

    def read(path: str) -> str | None:
        file = base_dir / path
        return file.read_text(errors="replace") if file.is_file() else None

    return read


def git_base(workspace: Path, rev: str) -> BaseReader | None:
    """Reads a git revision, or None when the workspace has no commit by that name."""
    verify = ["git", "-C", str(workspace), "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}"]
    if subprocess.run(verify, capture_output=True, check=False).returncode != 0:
        return None

    def read(path: str) -> str | None:
        shown = subprocess.run(
            ["git", "-C", str(workspace), "show", f"{rev}:./{path}"],
            capture_output=True,
            check=False,
        )
        return shown.stdout.decode(errors="replace") if shown.returncode == 0 else None

    return read


def run_coverage(workspace: Path, coverage_bin: str, scratch: Path) -> Path | None:
    """Runs pytest under coverage.py, keeping its data and caches out of the workspace.

    Only pytest exits 0 (passed) and 1 (some tests failed) mean the tests ran. A collection
    error, internal error, usage error or empty collection returns no report, as does a
    coverage binary that cannot start. Earlier data is removed first.
    """
    scratch.mkdir(parents=True, exist_ok=True)
    data_file, report = scratch / ".coverage", scratch / "coverage.json"
    data_file.unlink(missing_ok=True)
    report.unlink(missing_ok=True)
    data = f"--data-file={data_file}"
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    pytest = [coverage_bin, "run", data, "-m", "pytest", "-q", "-p", "no:cacheprovider"]
    to_json = [coverage_bin, "json", data, "-o", str(report)]
    try:
        tested = subprocess.run(pytest, cwd=workspace, env=env, stdout=STDERR_FD, check=False)
        if tested.returncode not in TESTS_RAN:
            return None
        made = subprocess.run(to_json, cwd=workspace, stdout=STDERR_FD, check=False)
    except OSError:
        return None
    return report if made.returncode == 0 and report.is_file() else None


def main(argv: list[str] | None = None) -> int:
    """Checks each input once: without a baseline nothing is known to have changed, and
    without a coverage report nothing is known to be untested, so either writes no rows
    and exits non-zero rather than reading the gap as findings."""
    args = _parse(argv)
    workspace, out = Path(args.workspace), Path(args.out)
    read_base = dir_base(Path(args.base_dir)) if args.base_dir else git_base(workspace, args.base_rev)
    if read_base is None:
        return _unknown(out, "no-baseline", f"cannot read the baseline {args.base_dir or args.base_rev}")
    coverage = _trusted_coverage(args, workspace, out)
    if coverage is None:
        return _unknown(out, "no-coverage", "no coverage report the tests fully produced")
    changed, rows = diff_uncovered(workspace, read_base, coverage)
    write_findings(out, rows)
    print_summary(outcome="ok", items_in=changed, items_out=len(rows))
    return 0


def _trusted_coverage(args: argparse.Namespace, workspace: Path, out: Path) -> dict[str, FileCoverage] | None:
    """The report, or None when there is none, it does not parse, or it measured none of
    the workspace's source files (a run that imported nothing, or paths from elsewhere)."""
    if args.coverage_json:
        report = Path(args.coverage_json) if Path(args.coverage_json).is_file() else None
    else:
        report = run_coverage(workspace, args.coverage, out.parent / "coverage")
    if report is None:
        return None
    try:
        coverage = read_coverage_json(report, workspace)
    except (ValueError, AttributeError):
        return None
    return coverage if coverage.keys() & set(source_files(workspace)) else None


def _unknown(out: Path, outcome: str, reason: str) -> int:
    print(f"diff_uncovered: {reason}; writing no findings", file=sys.stderr)
    write_findings(out, [])
    print_summary(outcome=outcome, items_in=0, items_out=0)
    return 1


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="findings.diff_uncovered", description=__doc__.splitlines()[0])
    parser.add_argument("--workspace", required=True)
    base = parser.add_mutually_exclusive_group(required=True)
    base.add_argument("--base-dir", help="an earlier snapshot of the workspace")
    base.add_argument("--base-rev", help="a git revision of the workspace, such as the merge-base")
    parser.add_argument("--coverage-json", help="existing `coverage json` output; skips the pytest run")
    parser.add_argument("--coverage", default=DEFAULT_COVERAGE, help="coverage.py executable")
    parser.add_argument("--out", required=True, help="findings.jsonl to write")
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
