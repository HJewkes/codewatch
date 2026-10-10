"""The bench's hidden repository: `GIT_DIR=.codewatch/repo.git`, `core.worktree` = the workspace.

Only stages set `GIT_DIR`, so the solve session sees no `.git` and no `GIT_DIR` (design
section 1). `main` holds the merged state through checkpoint N-1; checkpoint N works on
`cp-N`. Names a stage creates for one PR are scoped to its branch, as in `scoped`.
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

GIT_DIR = Path(".codewatch") / "repo.git"
BASE_BRANCH = "main"
AUTHOR = ("codewatch-bench", "codewatch-bench@localhost")
# Git ignores a GIT_DIR inside the work tree only when it is named `.git`, so without its
# own line `git add -A` stages the repository into itself. The index cache and the audit
# output are rebuilt every run and never committed (design section 1, "Carry"). The rest
# is what test runs and virtualenvs leave behind, which the grader's snapshot skips too.
EXCLUDES = (
    "/.codewatch/repo.git/", "/.codewatch/cache/", "/.codewatch/audit/", "/.codewatch/graph.db*",
    "__pycache__/", "*.py[cod]", ".venv/", "venv/", ".pytest_cache/", ".ruff_cache/",
    ".mypy_cache/", ".coverage", ".coverage.*", "htmlcov/", "node_modules/",
    "/.evaluation_tests/", "/.claude/", "/.opencode/",
)


class GitError(RuntimeError):
    pass


def pr_branch(checkpoint: int) -> str:
    return f"cp-{checkpoint}"


def scoped(name: str, branch: str) -> str:
    """A name unique to one PR branch, such as the graph ref `cw-merge-base-cp-2`.

    The repository and the graph database outlive a checkpoint, so a bare name would
    collide with, or silently resolve to, what an earlier checkpoint left behind.
    """
    return f"{name}-{branch}"


@dataclass(frozen=True)
class HiddenRepo:
    workspace: Path
    git_dir: Path

    @classmethod
    def at(cls, workspace: Path) -> HiddenRepo:
        workspace = workspace.resolve()
        return cls(workspace, workspace / GIT_DIR)

    def env(self) -> dict[str, str]:
        """The env for git and for tools that read git, such as `graph index --rev`."""
        name, email = AUTHOR
        return {**os.environ, "GIT_DIR": str(self.git_dir),
                "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email,
                "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email}

    def run(self, *args: str) -> str:
        # The workspace is a bind mount whose owner may differ from the container user.
        done = subprocess.run(["git", "-c", "safe.directory=*", *args], cwd=self.workspace,
                              env=self.env(), capture_output=True, text=True, check=False)
        if done.returncode != 0:
            raise GitError(f"git {' '.join(args)}: {done.stderr.strip()}")
        return done.stdout.strip()

    def succeeds(self, *args: str) -> bool:
        try:
            self.run(*args)
        except GitError:
            return False
        return True

    def exists(self) -> bool:
        return (self.git_dir / "HEAD").is_file()

    def init(self) -> None:
        self.git_dir.parent.mkdir(parents=True, exist_ok=True)
        self.run("init", "-q", f"--initial-branch={BASE_BRANCH}")
        self.run("config", "core.bare", "false")
        self.run("config", "core.worktree", str(self.workspace))

    def ensure_excludes(self) -> None:
        """Adds `EXCLUDES` to `info/exclude`, keeping the patterns already there."""
        exclude = self.git_dir / "info" / "exclude"
        exclude.parent.mkdir(parents=True, exist_ok=True)
        lines = exclude.read_text().splitlines() if exclude.is_file() else []
        missing = [p for p in EXCLUDES if p not in lines]
        if missing:
            exclude.write_text("".join(f"{line}\n" for line in [*lines, *missing]))

    def branch(self) -> str:
        return self.run("rev-parse", "--abbrev-ref", "HEAD")

    def rev(self, ref: str) -> str:
        return self.run("rev-parse", "--verify", f"{ref}^{{commit}}")

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        return self.succeeds("merge-base", "--is-ancestor", ancestor, descendant)

    def merge_base(self) -> str:
        return self.run("merge-base", BASE_BRANCH, "HEAD")

    def dirty(self) -> bool:
        return bool(self.run("status", "--porcelain"))

    def commit_all(self, message: str) -> str:
        """Commits the whole work tree, even when nothing changed, so each step has its commit."""
        self.run("add", "-A")
        self.run("commit", "-q", "--no-verify", "--allow-empty", "-m", message)
        return self.rev("HEAD")

    def point_head_at(self, branch: str, commit: str) -> None:
        """Moves HEAD to `branch` at `commit` and resets the index, never touching work tree files."""
        if self.branch() != branch:
            self.run("branch", "-f", branch, commit)
        else:
            self.run("update-ref", f"refs/heads/{branch}", commit)
        self.run("symbolic-ref", "HEAD", f"refs/heads/{branch}")
        self.run("reset", "-q")
