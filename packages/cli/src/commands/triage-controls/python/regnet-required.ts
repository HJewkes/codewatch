import type { ControlDefinition } from "../types.js";

export const pyRegnetRequired: ControlDefinition = {
  id: "py-regnet-required",
  kind: "regnet-diff",
  label: "clean",
  rationale: "The output changed from 12.5 to 12.50, and the spec's summary section requires exactly two decimal places from this part on.",
  path: "ledger/cli.py",
  findings: [
    {
      lineStart: 12,
      lineEnd: 14,
      symbol: "summary",
      signal: "regnet-diff",
      tool: "regnet",
      anchor: "def summary(",
      evidence: "ledger summary --file book.json: stdout changed\n- total: 12.5\n+ total: 12.50",
    },
  ],
  text: `"""Command line entry point for the ledger tool."""

from __future__ import annotations

import argparse
import json
import sys

from ledger.store import load_entries


def summary(entries: list[dict[str, float]]) -> str:
    total = sum(entry["amount"] for entry in entries)
    return f"total: {total:.2f}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ledger")
    parser.add_argument("command", choices=["summary", "list"])
    parser.add_argument("--file", required=True)
    args = parser.parse_args(argv)
    entries = load_entries(args.file)
    if args.command == "summary":
        print(summary(entries))
    else:
        json.dump(entries, sys.stdout, indent=2)
    return 0
`,
  spec: `# Ledger tool, part 2

Commands from part 1 keep working unless this part changes them.

## summary

\`ledger summary --file <path>\` prints one line: \`total: \` followed by the sum of every entry's amount.
From this part on, the total always shows exactly two decimal places, so 12.5 prints as \`total: 12.50\`.

## list

\`ledger list --file <path>\` prints the entries as a JSON array indented by two spaces.
`,
};
