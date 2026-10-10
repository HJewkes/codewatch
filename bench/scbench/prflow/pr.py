"""The `repo-init` and `pr-open` stages, and the merge of a PR branch into `main`.

None of them changes a file in the work tree: they move refs and the index only, so the
solve session starts from exactly the workspace the previous checkpoint left.
"""

from __future__ import annotations

from .ratchet import CHECK_CONFIG, Tool, ensure_check_config
from .repo import BASE_BRANCH, HiddenRepo, pr_branch

NO_REPO = "no hidden repository; repo-init did not run"


def repo_init(repo: HiddenRepo, tool: Tool) -> dict:
    """Creates the repository with a `main` that holds only codewatch's check config.

    Idempotent: it runs at the agent's first checkpoint, which is also the first one after
    a `--resume`.
    """
    if repo.exists():
        repo.ensure_excludes()
        return {"outcome": "exists"}
    repo.init()
    repo.ensure_excludes()
    reason = ensure_check_config(tool, repo)
    if (repo.workspace / CHECK_CONFIG).is_file():
        repo.run("add", "--", str(CHECK_CONFIG))
    repo.run("commit", "-q", "--no-verify", "--allow-empty", "-m", "repo-init: codewatch config")
    return {"outcome": "created", **({"reason": reason} if reason else {})}


def pr_open(repo: HiddenRepo, checkpoint: int) -> dict:
    """Opens `cp-N` from `main`, first merging a previous PR branch no stage merged."""
    if not repo.exists():
        return {"outcome": "skipped", "reason": NO_REPO}
    repo.ensure_excludes()
    branch, current = pr_branch(checkpoint), repo.branch()
    if current == branch:
        return {"outcome": "already-open", "branch": branch}
    report: dict = {"outcome": "opened", "branch": branch}
    start = BASE_BRANCH
    if current != BASE_BRANCH:
        commit_pending(repo, current)
        if merge_into_main(repo, current, f"Merge {current} into {BASE_BRANCH}\n\nMerged by pr-open."):
            report["reason"] = f"merged {current}, which no stage had merged"
        else:
            start = current
            report["reason"] = f"{BASE_BRANCH} has commits {current} lacks; {branch} opened from {current}"
    repo.point_head_at(branch, repo.rev(start))
    return report


def merge_pr(repo: HiddenRepo, message: str) -> dict:
    """Merges the checked-out PR branch into `main` and leaves HEAD on `main`, for the fold commit."""
    if not repo.exists():
        return {"outcome": "skipped", "reason": NO_REPO}
    branch = repo.branch()
    if branch == BASE_BRANCH:
        return {"outcome": "skipped", "reason": f"HEAD is already on {BASE_BRANCH}"}
    commit_pending(repo, branch)
    merged = merge_into_main(repo, branch, message)
    if merged is None:
        return {"outcome": "skipped", "reason": f"{BASE_BRANCH} has commits {branch} lacks"}
    repo.point_head_at(BASE_BRANCH, merged)
    return {"outcome": "merged", "branch": branch, "merge_commit": merged}


def commit_pending(repo: HiddenRepo, branch: str) -> None:
    """Keeps what a stage left uncommitted on its PR branch, so a merge carries it."""
    if repo.dirty():
        repo.commit_all(f"{branch}: stage output left uncommitted")


def merge_into_main(repo: HiddenRepo, branch: str, message: str) -> str | None:
    """A `--no-ff` merge built from refs alone; None when `main` has commits `branch` lacks.

    `main` is an ancestor of `branch`, so the merge's tree is `branch`'s tree and no file
    in the work tree changes.
    """
    main, head = repo.rev(BASE_BRANCH), repo.rev(branch)
    if not repo.is_ancestor(main, head):
        return None
    tree = repo.run("rev-parse", f"{head}^{{tree}}")
    merged = repo.run("commit-tree", tree, "-p", main, "-p", head, "-m", message)
    repo.run("update-ref", f"refs/heads/{BASE_BRANCH}", merged, main)
    return merged
