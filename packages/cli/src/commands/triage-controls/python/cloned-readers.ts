import type { ControlDefinition } from "../types.js";

export const pyClonedReaders: ControlDefinition = {
  id: "py-cloned-readers",
  kind: "clone",
  label: "slop",
  rationale: "Both readers parse the same columns the same way and differ only in name, so a format change would have to be made twice.",
  path: "stations/readers.py",
  findings: [
    {
      lineStart: 20,
      lineEnd: 26,
      signal: "clone",
      tool: "jscpd",
      anchor: "rows = []",
      evidence: "duplicates stations/readers.py:10-16",
    },
  ],
  text: `"""Readers for the station export formats."""

from __future__ import annotations

import csv
from pathlib import Path


def read_hourly(path: Path) -> list[dict[str, float]]:
    rows = []
    with path.open(newline="") as handle:
        for record in csv.DictReader(handle):
            if not record["value"]:
                continue
            rows.append({"time": float(record["time"]), "value": float(record["value"])})
    return rows


def read_daily(path: Path) -> list[dict[str, float]]:
    rows = []
    with path.open(newline="") as handle:
        for record in csv.DictReader(handle):
            if not record["value"]:
                continue
            rows.append({"time": float(record["time"]), "value": float(record["value"])})
    return rows
`,
};
