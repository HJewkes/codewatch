"""Copies one checkpoint's audit outputs into its agent artifacts directory.

Standard library only. The grader's snapshot skips `.codewatch/`, and the next
checkpoint's stages rewrite these files, so without a copy only `stages.json` counts
would survive the workspace.
"""

from __future__ import annotations

import shutil
from pathlib import Path

AUDIT_DIR = Path(".codewatch") / "audit"
# findings.jsonl from the audit stage, verdicts.jsonl from triage, items.jsonl (the fix
# stage's items in the order it worked them) from remediation/stage.py.
KEPT_FILES = ("findings.jsonl", "verdicts.jsonl", "items.jsonl")


def keep_audit_files(workspace: Path, dest: Path) -> list[str]:
    """Copies whichever of `KEPT_FILES` exist and returns their names in that order."""
    audit = workspace / AUDIT_DIR
    kept = [name for name in KEPT_FILES if (audit / name).is_file()]
    if kept:
        dest.mkdir(parents=True, exist_ok=True)
    for name in kept:
        shutil.copyfile(audit / name, dest / name)
    return kept
