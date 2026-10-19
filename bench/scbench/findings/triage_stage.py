"""The A1 triage stage: `codewatch triage`, then its spend from `triage.json` as the report line.

`codewatch triage` prints a human summary, while the stage agent reads `tokens` and `usd`
from the last stdout line, so run bare it records a paid stage at $0 in `stages.json`.
The summary goes to stderr. A `triage.json` older than this run reports nothing, since
its spend is an earlier run's.

    PYTHONPATH=/opt/codewatch-a1 python -P -m findings.triage_stage --workspace /workspace -- <triage args>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from findings.audit_stage import AUDIT, CODEWATCH, Run, run_tool

TRIAGE_JSON = "triage.json"
TOKEN_KEYS = ("inputTokens", "outputTokens", "cacheCreationInputTokens", "cacheReadInputTokens")


def spend(report: dict) -> dict:
    """The stage metrics of one `triage.json`; tokens count cache reads, as the fix stage's do."""
    traces = [t for t in report.get("traces") or [] if isinstance(t, dict)]
    verdicts = report.get("verdicts") or {}
    return {
        "tokens": sum(int(t.get(key) or 0) for t in traces for key in TOKEN_KEYS),
        "usd": float((report.get("cost") or {}).get("spentUsd") or 0.0),
        "items_in": int(verdicts.get("asked") or 0),
        "items_out": int(verdicts.get("written") or 0),
    }


def _mtime(path: Path) -> int | None:
    return path.stat().st_mtime_ns if path.is_file() else None


def fresh_report(path: Path, before: int | None) -> dict | None:
    if _mtime(path) in (None, before):
        return None
    try:
        parsed = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def triage_stage(workspace: Path, args: list[str], run: Run) -> tuple[int, dict]:
    triage_json = workspace / AUDIT / TRIAGE_JSON
    before = _mtime(triage_json)
    done = run([CODEWATCH, "triage", str(workspace), *args], os.environ, workspace)
    for text in (done.stdout, done.stderr):
        if text:
            print(text.rstrip("\n"), file=sys.stderr)
    report = fresh_report(triage_json, before)
    outcome = "ok" if done.returncode == 0 else "failed"
    if report is None:
        return done.returncode, {"outcome": outcome, "reason": f"no {TRIAGE_JSON} written by this run, so its spend is unknown"}
    return done.returncode, {"outcome": outcome, **spend(report)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="findings.triage_stage", description=__doc__.splitlines()[0])
    parser.add_argument("--workspace", type=Path, default=Path("/workspace"))
    parser.add_argument("triage_args", nargs=argparse.REMAINDER)
    parsed = parser.parse_args(argv)
    args = parsed.triage_args[1:] if parsed.triage_args[:1] == ["--"] else parsed.triage_args
    code, report = triage_stage(parsed.workspace.resolve(), args, run_tool)
    print(json.dumps(report))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
