"""The bench's hidden repository: `GIT_DIR=.codewatch/repo.git`, work tree = the workspace.

Only stages set `GIT_DIR`, so the solve session never sees a `.git` (design section 1).
The `repo-init`, `pr-open` and `commit-ratchet` stages (U15, `prflow/`) create the
repository, open `cp-N` and commit the solve; this module only adds, reverts and merges fix
commits. The repository's layout and excludes are U15's, imported from `prflow.repo`.
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from prflow.repo import EXCLUDES

BASE_BRANCH = "main"
AUTHOR = ("codewatch-fix", "codewatch-fix@localhost")


class GitError(RuntimeError):
    pass



@dataclass(frozen=True)
class Git:
    workspace: Path
    git_dir: Path

    def env(self) -> dict[str, str]:
        name, email = AUTHOR
        return {**os.environ, "GIT_DIR": str(self.git_dir), "GIT_WORK_TREE": str(self.workspace),
                "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email,
                "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email}

    def run(self, *args: str) -> str:
        done = subprocess.run(["git", *args], cwd=self.workspace, env=self.env(),
                              capture_output=True, text=True, check=False)
        if done.returncode != 0:
            raise GitError(f"git {' '.join(args)}: {done.stderr.strip()}")
        return done.stdout.strip()

    def exists(self) -> bool:
        return (self.git_dir / "HEAD").is_file()

    def ignore_tool_output(self) -> None:
        """Add U15's `EXCLUDES` to `info/exclude`, keeping whatever patterns are already there.

        They cover tool output (bytecode, caches, a virtualenv) and `.codewatch/`'s rebuilt
        parts, so those never count as an edit, are never committed, and survive `clean -fd`.
        The committed parts of `.codewatch/`, such as `taste.md`, stay visible.
        """
        exclude = self.git_dir / "info" / "exclude"
        exclude.parent.mkdir(parents=True, exist_ok=True)
        lines = exclude.read_text().splitlines() if exclude.is_file() else []
        missing = [p for p in EXCLUDES if p not in lines]
        if missing:
            exclude.write_text("".join(f"{line}\n" for line in [*lines, *missing]))

    def head(self) -> str:
        return self.run("rev-parse", "HEAD")

    def branch(self) -> str:
        return self.run("rev-parse", "--abbrev-ref", "HEAD")

    def merge_base(self, base: str = BASE_BRANCH) -> str:
        return self.run("merge-base", base, "HEAD")

    def changed_files(self, since: str) -> set[str]:
        return set(filter(None, self.run("diff", "--name-only", since, "HEAD").splitlines()))

    def files_in(self, commit: str) -> set[str]:
        return set(filter(None, self.run("show", "--name-only", "--format=", commit).splitlines()))

    def dirty(self) -> bool:
        return bool(self.run("status", "--porcelain"))

    def commit_all(self, message: str, amend: bool = False) -> str:
        self.run("add", "-A")
        self.run("commit", "-q", "--no-verify", *(["--amend"] if amend else []), "-m", message)
        return self.head()

    def revert(self, commit: str) -> None:
        self.run("revert", "--no-edit", commit)

    def switch(self, branch: str, create: bool = False) -> None:
        """`create` resets a branch a crashed run on this checkpoint left behind."""
        self.run("switch", "-q", *(["-C"] if create else []), branch)

    def merge(self, branch: str, message: str) -> None:
        self.run("merge", "-q", "--no-ff", "-m", message, branch)

    def reset_to(self, branch: str, commit: str) -> None:
        """The consistency reset: back on `branch` at `commit`, with no stray edits."""
        self.run("reset", "-q", "--hard")
        self.run("switch", "-q", "-f", branch)
        self.run("reset", "-q", "--hard", commit)
        self.run("clean", "-q", "-fd")
