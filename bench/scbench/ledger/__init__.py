"""The cleanup ledger (C-248 S5): one JSONL file per run, `<run dir>/ledger.jsonl`.

Two record kinds share the file:
  task       one per task the run started (columns.py): its type, cluster, wave, projected and realised
             gain, structural cost, $, gates, retry used, self-check calls, per-family deltas and
             tolerances, integration-revert, and next_checkpoint (left empty; C-249 fills it). A task that
             never ran carries outcome `skip` and the reason.
  judgement  a later verdict on a rejected task, by T3 or the owner (good or not); the false-reject
             roll-up (rollup.py) reads them for E4.
The rules a run applies at task start (stale finding, repeat suppression) and the T2 re-inline check
read the ledger through rules.py. The S4 gate and the frozen planner config are only read, never changed.
"""

from __future__ import annotations

import json
from pathlib import Path

FILE = "ledger.jsonl"


def ledger_path(run_dir: Path) -> Path:
    return Path(run_dir) / FILE


def append(path: Path, record: dict) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as out:
        out.write(json.dumps(record, sort_keys=True) + "\n")
    return record


def read(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def tasks(records: list[dict]) -> list[dict]:
    return [r for r in records if r.get("kind") == "task"]


def judgements(records: list[dict]) -> list[dict]:
    return [r for r in records if r.get("kind") == "judgement"]


def judgement(run: str, cluster: str, by: str, good: bool, note: str = "") -> dict:
    if by not in ("T3", "owner"):
        raise ValueError(f"a judgement is by T3 or the owner, not {by!r}")
    return {"kind": "judgement", "run": run, "cluster": cluster, "by": by, "good": good, "note": note}
