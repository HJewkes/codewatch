"""A whole-workspace copy taken before the fix stage: the last resort when an error leaves
the hidden repository unable to reset the work tree.

The copy includes `.codewatch/` (the hidden repository too) and any virtual environment.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path


def inside(workspace: Path, path: Path) -> bool:
    return path.resolve().is_relative_to(workspace.resolve())


def backup(workspace: Path, scratch: Path) -> Path:
    if inside(workspace, scratch):
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


def restore_or_keep(workspace: Path, saved: Path) -> str | None:
    """Restores, then drops the backup; on a failed restore the backup stays and the error is returned."""
    try:
        restore(workspace, saved)
    except Exception as error:  # noqa: BLE001 - the backup must survive any restore failure
        return f"{type(error).__name__}: {error}"
    drop(saved)
    return None
