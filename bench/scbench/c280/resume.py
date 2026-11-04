"""C-280 S4: incremental results and load gating for the probe, so a stop loses no finished unit."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path

LOAD_LIMIT = 24.0
RUN_SECONDS = "_run_seconds"


def load5() -> float:
    return float(Path("/proc/loadavg").read_text().split()[1])


def wait_for_load(limit: float = LOAD_LIMIT, read: Callable[[], float] = load5,
                  sleep: Callable[[float], None] = time.sleep) -> None:
    while read() >= limit:
        sleep(60)


def finished(partial: Path) -> tuple[dict[str, dict], float]:
    """The completed unit rows by id, and the wall seconds that earlier runs already spent."""
    rows: dict[str, dict] = {}
    spent = 0.0
    if partial.is_file():
        for line in filter(None, partial.read_text().splitlines()):
            row = json.loads(line)
            if RUN_SECONDS in row:
                spent += row[RUN_SECONDS]
            else:
                rows[row["unit"]] = row
    return rows, spent


def record(partial: Path, row: dict) -> None:
    partial.parent.mkdir(parents=True, exist_ok=True)
    with partial.open("a") as handle:
        handle.write(json.dumps(row) + "\n")
