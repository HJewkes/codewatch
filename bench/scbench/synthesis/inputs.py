"""Read the synthesis inputs: triage verdicts, recorded taste, and the PR's deltas against its merge-base."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from pathlib import Path

Cli = Callable[[list[str]], str]

# Opt-in: None keeps every ratchet item.
MAX_OPEN_ITEMS: int | None = None
MAX_CHANGED_SYMBOLS = 5
INPUT_CLASS_SIGNAL = "entry-input-class"
MAX_INPUT_CLASS_ITEMS = 3


def run_codewatch(args: list[str]) -> str:
    """stdout of `codewatch <args>`."""
    done = subprocess.run(["codewatch", *args], capture_output=True, text=True, timeout=120)
    return done.stdout


def read_json(path: Path) -> dict | None:
    return _json_or_none(path.read_text()) if path.is_file() else None


def read_verdicts(path: Path) -> list[dict]:
    """Every well-formed JSONL row (verdicts, findings); a malformed line is skipped on its own."""
    if not path.is_file():
        return []
    rows = (_json_or_none(line) for line in path.read_text().splitlines() if line.strip())
    return [row for row in rows if row is not None]


def _json_or_none(text: str) -> dict | None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def recorded_taste(codewatch: Path, own_fragment: str) -> list[str]:
    """The taste head's lines, then each other unmerged fragment's, so synthesis does not repeat them."""
    fragments = sorted((p for p in (codewatch / "taste.d").glob("*.md") if p.name != own_fragment),
                       key=lambda p: p.name)
    files = [p for p in (codewatch / "taste.md", *fragments) if p.is_file()]
    return [line.rstrip() for p in files for line in p.read_text().splitlines() if line.strip()]


def new_violations(check: dict | None) -> list[dict]:
    """The violations a `graph check --baseline <merge-base>` report finds new in the PR head."""
    violations = ((check or {}).get("result") or {}).get("violations") or []
    return [v for v in violations if isinstance(v, dict) and not v.get("isCarryover")]


def changed_symbols(cli: Cli, db: Path, check: dict | None) -> list[dict]:
    """Symbols whose footprint changed between the check's baseline and head, most-imported file first."""
    head = ((check or {}).get("snapshot") or {}).get("id")
    base = ((check or {}).get("baselineSnapshot") or {}).get("id")
    if head is None or base is None:
        return []
    top = _json_or_none(cli(["graph", "top", "--db", str(db), "--snapshot", str(head), "--metric", "fan_in",
                             "--kind", "file", "--limit", "100000", "--json"])) or {}
    importers = {row["nodeId"]: row.get("value") or 0 for row in top.get("rows", [])}
    diff = _json_or_none(cli(["graph", "diff", "--db", str(db), "--footprint", "--from", str(base),
                              "--to", str(head), "--json"])) or {}
    symbols = [
        {"symbol": change["symbolId"], "importers": int(importers.get(change.get("fileId"), 0))}
        for change in diff.get("changes") or []
        if change.get("status") != "removed"
    ]
    ranked = sorted((s for s in symbols if s["importers"] > 0), key=lambda s: (-s["importers"], s["symbol"]))
    return ranked[:MAX_CHANGED_SYMBOLS]


def _evidence_field(evidence: str, name: str) -> str:
    """A `<name>: <value>` line of a finding's evidence, "" when absent."""
    line = next((line for line in evidence.split("\n") if line.startswith(f"{name}:")), "")
    return line[len(name) + 1:].strip()


def _input_class_text(finding: dict) -> str:
    evidence = finding.get("evidence") or ""
    entry = (_evidence_field(evidence, "entry").split() or [finding.get("symbol") or "the entry point"])[0]
    subject, _, read_by = _evidence_field(evidence, "class").partition(", ")
    where = f" ({read_by})" if read_by else ""
    # The answer is the spec's to give (C-233): a test pinning today's behaviour could pin a bug.
    return (f"`{entry}` never gets: {_evidence_field(evidence, 'never')} for {subject}{where}. "
            "Do not pin a guess: check the spec or an earlier checkpoint, and if neither says, note the gap.")


def input_class_items(findings: list[dict]) -> list[dict]:
    """The brief's question-worded items for `entry-input-class` findings, at most 3 per entry, in audit order."""
    items, per_entry = [], {}
    for finding in findings:
        entry = (finding.get("path"), finding.get("symbol"))
        if finding.get("signal") != INPUT_CLASS_SIGNAL or per_entry.get(entry, 0) >= MAX_INPUT_CLASS_ITEMS:
            continue
        per_entry[entry] = per_entry.get(entry, 0) + 1
        items.append({"kind": "input-class", "path": finding.get("path", ""), "line": finding.get("lineStart"),
                      "text": _input_class_text(finding)})
    return items


def ratchet_items(violations: list[dict]) -> list[dict]:
    """The brief's open items: new violations. The hook adds confirmed verdicts from the verdict files."""
    return [{"kind": "ratchet", "path": v.get("path") or v.get("nodeId", ""), "line": v.get("lineStart"),
             "text": v.get("evidence") or v.get("message", "")} for v in violations][:MAX_OPEN_ITEMS]
