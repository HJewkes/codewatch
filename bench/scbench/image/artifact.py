"""Pins the codewatch CLI that the A1 image installs: a `pnpm deploy` directory built from a clean sha.

build.sh runs it as a script; the logic sits here so the tests can reach it.

    python3 artifact.py check-clean <source>     prints the source sha, exits 1 on a dirty tree
    python3 artifact.py entry <source> <deploy>  prints the manifest's `codewatch` entry as JSON
    python3 artifact.py tag <version> <sha>      prints the image tag

The artifact hash covers the deploy directory's sorted file list, so it does not depend on the
order the filesystem lists entries in. Symlinks (pnpm's layout is mostly links) count by target.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path


class DirtySource(Exception):
    """The source tree has uncommitted or untracked changes, so its sha does not pin the build."""


def _git(source: Path, *args: str) -> str:
    done = subprocess.run(["git", "-C", str(source), *args], capture_output=True, text=True, check=True)
    return done.stdout.strip()


def source_state(source: Path) -> tuple[str, bool]:
    """The source's HEAD sha and whether its tree differs from that sha."""
    return _git(source, "rev-parse", "HEAD"), bool(_git(source, "status", "--porcelain"))


def require_clean(source: Path) -> str:
    sha, dirty = source_state(source)
    if dirty:
        raise DirtySource(f"{source} has uncommitted or untracked changes; the image must pin a committed sha")
    return sha


def _entries(root: Path) -> list[str]:
    found = []
    for directory, dirs, files in os.walk(root):
        for name in [*dirs, *files]:
            path = Path(directory, name)
            if path.is_symlink() or not path.is_dir():
                found.append(path.relative_to(root).as_posix())
    return found


def _describe(path: Path) -> bytes:
    if path.is_symlink():
        return b"l\0" + os.readlink(path).encode()
    kind = b"x" if path.stat().st_mode & stat.S_IXUSR else b"f"
    return kind + b"\0" + hashlib.sha256(path.read_bytes()).hexdigest().encode()


def artifact_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for relative in sorted(_entries(root)):
        digest.update(relative.encode() + b"\0" + _describe(root / relative) + b"\n")
    return digest.hexdigest()


def image_tag(version: str, sha: str) -> str:
    return f"a1-cw{version}-{sha[:7]}"


def _origin(source: Path) -> str | None:
    try:
        return _git(source, "remote", "get-url", "origin") or None
    except subprocess.CalledProcessError:
        return None


def codewatch_entry(source: Path, deploy: Path) -> dict:
    """The run manifest's `codewatch` entry for a deploy directory built from `source`."""
    sha = require_clean(source)
    return {
        "repo": _origin(source),
        "source_sha": sha,
        "dirty": False,
        "version": json.loads((deploy / "package.json").read_text())["version"],
        "artifact_sha256": artifact_sha256(deploy),
    }


def main(argv: list[str]) -> int:
    command, *args = argv
    try:
        if command == "check-clean":
            print(require_clean(Path(args[0])))
        elif command == "entry":
            print(json.dumps(codewatch_entry(Path(args[0]), Path(args[1])), indent=2))
        elif command == "tag":
            print(image_tag(args[0], args[1]))
        else:
            raise SystemExit(f"artifact.py: unknown command {command}")
    except DirtySource as error:
        print(f"artifact.py: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
