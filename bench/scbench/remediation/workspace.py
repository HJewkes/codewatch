"""Copy the workspace aside before remediation, and put it back when remediation is discarded.

The copy is whole, `.codewatch/` and any virtual environment included, so a discarded
remediation leaves no trace in the graded snapshot or in graph.db.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path


def _within(parent: Path, child: Path) -> bool:
    return child.resolve().is_relative_to(parent.resolve())


def backup(workspace: Path, scratch: Path) -> Path:
    if _within(workspace, scratch):
        raise ValueError(f"scratch {scratch} is inside the workspace {workspace}")
    scratch.mkdir(parents=True, exist_ok=True)
    target = Path(tempfile.mkdtemp(prefix="remediation-", dir=scratch)) / "workspace"
    shutil.copytree(workspace, target, symlinks=True)
    return target


def _clear(directory: Path) -> None:
    for entry in directory.iterdir():
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry)
        else:
            entry.unlink()


def restore(workspace: Path, saved: Path) -> None:
    _clear(workspace)
    shutil.copytree(saved, workspace, symlinks=True, dirs_exist_ok=True)


def drop(saved: Path) -> None:
    shutil.rmtree(saved.parent, ignore_errors=True)
