"""Did a solve change the tree? Compares two trees while ignoring the files a run regenerates anyway."""

from __future__ import annotations

import hashlib
from pathlib import Path

IGNORED_NAMES = frozenset({".venv", "__pycache__", ".pytest_cache", ".evaluation_tests", "pytest.ini", ".report.json"})


def _files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.is_file() and not IGNORED_NAMES & set(p.relative_to(root).parts))


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in _files(root):
        digest.update(str(path.relative_to(root)).encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def trees_differ(a: Path, b: Path) -> bool:
    return tree_digest(a) != tree_digest(b)
