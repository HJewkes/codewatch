"""The `findings.jsonl` row contract shared with `codewatch audit` and `codewatch triage`."""

from __future__ import annotations

import json
from pathlib import Path


def finding_row(
    tool: str,
    signal: str,
    path: str,
    lines: tuple[int, int],
    evidence: str,
    symbol: str | None = None,
) -> dict:
    row = {
        "id": f"{tool}:{path}:{lines[0]}",
        "tool": tool,
        "signal": signal,
        "path": path,
        "lineStart": lines[0],
        "lineEnd": lines[1],
        "severity": "warning",
        "evidence": evidence,
    }
    return row if symbol is None else {**row, "symbol": symbol}


def write_findings(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))


def print_summary(**fields: object) -> None:
    """The last stdout line, which the stage runner reads for `items_in` and `items_out`."""
    print(json.dumps(fields))
