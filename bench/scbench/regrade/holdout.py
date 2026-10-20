"""holdout.py <problem>...: exit 3 if any problem is in the sealed SCBench holdout (C-243).

The climb driver's split control (C-212, OP §3), shared by every experiment harness: the
holdout list lives only in the gitignored manifest's `holdout` field, and a holdout problem
runs only when the SCBENCH_MILESTONE environment variable names a milestone and the climb
ledger holds an owner-approved holdout row for that milestone:

    {"split": "holdout", "milestone": "<id>", "ownerApproved": true, ...}

Stdlib only, so shell harnesses can run it with `python3 -I`. Never prints a problem name:
refusals report counts only. An unreadable manifest refuses everything (fail closed).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

CACHE = Path.home() / ".cache" / "codewatch-scbench"
MANIFEST = CACHE / "manifest.json"
LEDGER = CACHE / "climb" / "ledger.jsonl"
MILESTONE_ENV = "SCBENCH_MILESTONE"
REFUSED_EXIT = 3


class HoldoutRefused(Exception):
    pass


def holdout_problems(manifest: Path = MANIFEST) -> frozenset[str]:
    try:
        tiers = json.loads(manifest.read_text())["holdout"]["problems"]
        return frozenset(name for names in tiers.values() for name in names)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise HoldoutRefused(f"cannot read the holdout list ({type(error).__name__}); refusing") from error


def _ledger_rows(ledger: Path) -> list[dict]:
    if not ledger.is_file():
        return []
    rows = []
    for line in ledger.read_text().splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def milestone_approved(milestone: str | None, ledger: Path = LEDGER) -> bool:
    if not milestone:
        return False
    return any(row.get("split") == "holdout" and row.get("milestone") == milestone
               and row.get("ownerApproved") is True for row in _ledger_rows(ledger))


def check(problems: list[str], milestone: str | None = None, manifest: Path = MANIFEST,
          ledger: Path = LEDGER) -> None:
    """Raise HoldoutRefused unless no problem is held out or the milestone is owner-approved."""
    held = sum(1 for p in problems if p in holdout_problems(manifest))
    if held and not milestone_approved(milestone, ledger):
        raise HoldoutRefused(
            f"{held} of {len(problems)} problem(s) are in the sealed holdout; a holdout run needs "
            f"{MILESTONE_ENV}=<milestone> and an owner-approved holdout row for it in the climb ledger")


def main(argv: list[str]) -> int:
    try:
        check(argv, os.environ.get(MILESTONE_ENV))
    except HoldoutRefused as refusal:
        print(f"holdout guard: {refusal}", file=sys.stderr)
        return REFUSED_EXIT
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
