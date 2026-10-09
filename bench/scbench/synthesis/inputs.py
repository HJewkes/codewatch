"""Read the synthesis inputs: triage verdicts, new ratchet violations and changed symbols."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from pathlib import Path

Cli = Callable[[list[str]], str]

MAX_OPEN_ITEMS = 3
MAX_CHANGED_SYMBOLS = 5
REGRESSION_SIGNAL = "regnet-diff"


def run_codewatch(args: list[str]) -> str:
    """stdout of `codewatch <args>`; `graph check` exits non-zero when it finds violations."""
    done = subprocess.run(["codewatch", *args], capture_output=True, text=True, timeout=120)
    return done.stdout


def read_verdicts(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = (json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return [row for row in rows if isinstance(row, dict)]


def _json_or_none(text: str) -> dict | None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def new_violations(cli: Cli, db: Path, config: Path) -> list[dict]:
    """Violations in the latest snapshot that the previous snapshot did not have."""
    if not config.is_file():
        return []
    args = ["graph", "check", "--db", str(db), "--config", str(config), "--baseline", "previous", "--json"]
    report = _json_or_none(cli(args)) or {}
    violations = (report.get("result") or {}).get("violations") or []
    return [v for v in violations if isinstance(v, dict) and not v.get("isCarryover")]


def changed_symbols(cli: Cli, db: Path) -> list[dict]:
    """Symbols whose footprint changed since the previous snapshot, most-imported file first."""
    top = _json_or_none(cli(["graph", "top", "--db", str(db), "--metric", "fan_in", "--kind", "file",
                             "--limit", "100000", "--json"]))
    snapshot_id = ((top or {}).get("snapshot") or {}).get("id")
    if snapshot_id is None:
        return []
    importers = {row["nodeId"]: row.get("value") or 0 for row in top.get("rows", [])}
    diff = _json_or_none(cli(["graph", "diff", "--db", str(db), "--footprint", "--from", "previous",
                              "--to", str(snapshot_id), "--json"])) or {}
    symbols = [
        {"symbol": change["symbolId"], "importers": int(importers.get(change.get("fileId"), 0))}
        for change in diff.get("changes") or []
        if change.get("status") != "removed"
    ]
    ranked = sorted((s for s in symbols if s["importers"] > 0), key=lambda s: (-s["importers"], s["symbol"]))
    return ranked[:MAX_CHANGED_SYMBOLS]


def _verdict_item(kind: str, row: dict) -> dict:
    citations = row.get("citations") or [{}]
    return {"kind": kind, "path": row.get("path", ""), "line": citations[0].get("lineStart"),
            "text": row.get("rationale", "")}


def _violation_item(violation: dict) -> dict:
    return {"kind": "ratchet", "path": violation.get("path") or violation.get("nodeId", ""),
            "line": violation.get("lineStart"),
            "text": violation.get("evidence") or violation.get("message", "")}


def open_items(verdicts: list[dict], violations: list[dict]) -> list[dict]:
    """At most 3 items in a fixed order: confirmed regressions, new violations, other confirmed findings."""
    confirmed = [row for row in verdicts if row.get("verdict") == "confirmed"]
    regressions = [_verdict_item("regression", r) for r in confirmed if r.get("signal") == REGRESSION_SIGNAL]
    quality = [_verdict_item("quality", r) for r in confirmed if r.get("signal") != REGRESSION_SIGNAL]
    ratchet = [_violation_item(v) for v in violations]
    return (regressions + ratchet + quality)[:MAX_OPEN_ITEMS]
