"""The merging job: fold `.codewatch` fragments into their heads and commit that as one commit.

In the bench, synthesis runs it on `main` right after merging `cp-N`. With no fragment to
absorb it writes nothing and commits nothing, so a second run is a no-op.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

from prflow.repo import GitError, HiddenRepo

from .fold import Anchors, Folded, Fragment, fold_taste, fold_verdicts

CODEWATCH = Path(".codewatch")
TASTE = ("taste.md", "taste.d", ".md")
VERDICTS = ("verdicts.jsonl", "verdicts.d", ".jsonl")
FOLD_MESSAGE = "Fold taste and verdict fragments into their heads"


def head_anchors(db: Path, snapshot: int | None) -> Anchors | None:
    """Whether a node id is in the head snapshot; None when that cannot be read, so nothing is dropped.

    `graph top` lists only nodes that carry the asked metric, so the node table is read directly.
    """
    if snapshot is None or not db.is_file():
        return None
    try:
        with sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True) as conn:
            ids = {row[0] for row in conn.execute("SELECT id FROM node WHERE snapshot_id = ?", (snapshot,))}
    except sqlite3.Error as error:
        print(f"fold: head snapshot unreadable: {error}", file=sys.stderr)
        return None
    return ids.__contains__ if ids else None


def _read(codewatch: Path, layout: tuple[str, str, str]) -> tuple[str, list[Fragment]]:
    head, directory, suffix = layout
    head_path = codewatch / head
    fragments = sorted((codewatch / directory).glob(f"*{suffix}")) if (codewatch / directory).is_dir() else []
    return (head_path.read_text() if head_path.is_file() else "",
            [(p.name, p.read_text()) for p in fragments if p.is_file()])


def _apply(codewatch: Path, layout: tuple[str, str, str], folded: Folded) -> list[Path]:
    """Writes the head and deletes the absorbed fragments; the paths it changed."""
    head, directory, _ = layout
    if not folded.absorbed:
        return []
    (codewatch / head).write_text(folded.head)
    for name in folded.absorbed:
        (codewatch / directory / name).unlink()
    return [codewatch / head, *(codewatch / directory / name for name in folded.absorbed)]


def fold_files(codewatch: Path, present: Anchors | None) -> tuple[list[Path], dict]:
    """Folds both kinds of fragment on disk; the changed paths and the report."""
    taste = fold_taste(*_read(codewatch, TASTE))
    verdicts = fold_verdicts(*_read(codewatch, VERDICTS), present or (lambda _anchor: True))
    changed = _apply(codewatch, TASTE, taste) + _apply(codewatch, VERDICTS, verdicts)
    malformed = {f"{TASTE[1]}/{n}": why for n, why in taste.malformed.items()}
    malformed.update({f"{VERDICTS[1]}/{n}": why for n, why in verdicts.malformed.items()})
    report = {"absorbed": len(taste.absorbed) + len(verdicts.absorbed),
              "anchors": "unknown" if present is None else "head"}
    return changed, {**report, **({"malformed": malformed} if malformed else {})}


def _commit(repo: HiddenRepo, changed: list[Path]) -> str | None:
    """Commits exactly the changed paths, or None when they match HEAD already."""
    paths = [str(p.relative_to(repo.workspace)) for p in changed]
    tracked = set(repo.run("ls-files", "--", *paths).splitlines())
    staged = [p for p in paths if p in tracked or (repo.workspace / p).exists()]
    if staged:
        repo.run("add", "-A", "--", *staged)
    if repo.succeeds("diff", "--cached", "--quiet"):
        return None
    repo.run("commit", "-q", "--no-verify", "-m", FOLD_MESSAGE)
    return repo.rev("HEAD")


def run_fold(repo: HiddenRepo, present: Anchors | None) -> dict:
    """The fold and its one commit on the checked-out branch; the report stages.json records."""
    if not repo.exists():
        return {"outcome": "skipped", "reason": "no hidden repository; repo-init did not run"}
    changed, report = fold_files(repo.workspace / CODEWATCH, present)
    try:
        commit = _commit(repo, changed) if changed else None
    except GitError as error:
        return {**report, "outcome": "failed", "reason": str(error)}
    return {**report, "outcome": "folded" if commit else "nothing_to_fold",
            **({"fold_commit": commit} if commit else {})}
