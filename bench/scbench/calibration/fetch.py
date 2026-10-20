"""Network and git boundary for corpus selection: PyPI metadata, the GitHub repository page and a
blobless clone pinned to the release tag. Nothing from a downloaded project is ever executed."""

from __future__ import annotations

import json
import os
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from calibration.corpus import GITHUB

TIMEOUT = 60
GIT_ENV = {**os.environ, "GIT_LFS_SKIP_SMUDGE": "1", "GIT_TERMINAL_PROMPT": "0"}


def _get(url: str) -> tuple[str, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "codewatch-calibration"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.geturl(), response.read().decode(errors="replace")


def pypi_info(name: str) -> dict:
    return json.loads(_get(f"https://pypi.org/pypi/{name}/json")[1])["info"]


def github_page(repo: str) -> tuple[str, bool, bool]:
    """(owner/repo after redirects, is a fork, is archived) from the public repository page."""
    final, html = _get(f"https://github.com/{repo}")
    match = GITHUB.match(final)
    resolved = f"{match.group(1)}/{match.group(2)}".lower() if match else repo
    return resolved, "forked from" in html, "archived by the owner" in html


def git(path: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(path), *args], check=True, capture_output=True, text=True,
                          env=GIT_ENV, timeout=1800).stdout


def clone(repo: str, cache: Path) -> Path:
    dest = cache / "repos" / repo.replace("/", "__")
    if not (dest / ".git").exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout",
                        f"https://github.com/{repo}.git", str(dest)], check=True, capture_output=True,
                       env=GIT_ENV, timeout=1800)
    return dest


def tags(path: Path) -> list[str]:
    return git(path, "tag", "-l").split()


def commit_of(path: Path, tag: str) -> str:
    return git(path, "rev-parse", f"{tag}^{{commit}}").strip()


def file_sizes(path: Path) -> dict[str, int]:
    """Byte size per tracked file of the checked-out tree (ls-tree -l would fetch blobs one by one)."""
    names = git(path, "ls-files", "-z").split("\0")
    return {n: (path / n).lstat().st_size for n in names if n and (path / n).is_file() and not (path / n).is_symlink()}


def history(path: Path, sha: str, today: datetime) -> tuple[int, int, int]:
    """(commits up to sha, distinct author emails up to sha, days since the default branch's last commit)."""
    commits = int(git(path, "rev-list", "--count", sha).strip())
    authors = len(set(git(path, "log", "--format=%aE", sha).split()))
    last = datetime.fromisoformat(git(path, "log", "-1", "--format=%cI", "HEAD").strip())
    return commits, authors, (today - last.astimezone(timezone.utc)).days


def checkout(path: Path, sha: str) -> None:
    git(path, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "--force", sha)
