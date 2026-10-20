"""python3 -m ledger <run dir | ledger.jsonl> [...]: the roll-up over one or more runs' ledgers, as JSON.

Per type (pass rate, $ per accepted task, projected against realised gain), the retirement rows, and the
per-family false-reject roll-up for E4. Aggregates and cluster ids only, no source text.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ledger import judgements, ledger_path, read, tasks
from ledger.rollup import rollup


def load(paths: list[Path]) -> list[dict]:
    return [r for p in paths for r in read(ledger_path(p) if p.is_dir() else p)]


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python3 -m ledger")
    p.add_argument("ledgers", type=Path, nargs="+")
    records = load(p.parse_args(argv).ledgers)
    print(json.dumps(rollup(tasks(records), judgements(records)), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
