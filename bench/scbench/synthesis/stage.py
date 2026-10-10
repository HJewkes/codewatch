"""Run the synthesis stage over one workspace and return its `stages.json` report line.

The stage ends the PR: it ratchets the PR head against its merge-base again (the fix stage
may have moved it), writes the taste fragment, the derived brief and the PR report, then
merges `cp-N` into `main` with the report's markdown as the merge-commit message.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path

from prflow.pr import commit_pending, merge_pr
from prflow.ratchet import AUDIT, CHECK_CONFIG, CHECK_OUT, DB, DIFF_OUT, Tool, ratchet
from prflow.repo import GitError, HiddenRepo, pr_branch

from .inputs import Cli, changed_symbols, new_violations, ratchet_items, read_json, read_verdicts, recorded_taste
from .report import pr_report, render_markdown
from .taste import Model, build_prompt, cap_lines, listed_verdicts, tagged_lines

TASTE_DIR = "taste.d"
BRIEF = "session-brief.json"
PR_REPORT = "pr-report.json"


def _guarded(read: Callable[[], list[dict]], what: str) -> list[dict]:
    """A failed input reads as empty, so the rest of the stage still runs."""
    try:
        return read()
    except Exception as error:  # noqa: BLE001 - one missing input must not stop the stage
        print(f"synthesis: {what} unavailable: {type(error).__name__}: {error}", file=sys.stderr)
        return []


def _on_pr_branch(repo: HiddenRepo, branch: str) -> str | None:
    """Why the stage cannot ratchet or merge `branch`, or None when HEAD is on it."""
    if not repo.exists():
        return "no hidden repository; repo-init did not run"
    current = repo.branch()
    return None if current == branch else f"HEAD is on {current}, not {branch}"


def refresh_ratchet(repo: HiddenRepo, branch: str, tool: Tool) -> dict:
    """`graph check --baseline` and `graph diff` of the PR head against its merge-base, as commit-ratchet runs them."""
    why = _on_pr_branch(repo, branch)
    if why:
        return {"outcome": "skipped", "reason": why}
    try:
        commit_pending(repo, branch)
        return ratchet(repo, branch, repo.rev("HEAD"), repo.merge_base(), tool)
    except GitError as error:
        return {"outcome": "failed", "reason": str(error)}


def write_taste(codewatch: Path, checkpoint: int, verdicts: list[dict], violations: list[dict],
                symbols: list[dict], model: Model) -> dict:
    """The model call and `taste.d/cp-N.md`; the report keys stages.json records for it."""
    fragment = f"{pr_branch(checkpoint)}.md"
    listed = listed_verdicts(verdicts)
    report = {"tokens": 0, "usd": 0.0, "items_in": len(verdicts) + len(violations) + len(symbols)}
    if not listed:  # every taste line must cite a verdict, so without one a call is wasted
        return {**report, "items_out": 0, "outcome": "no_input"}
    try:
        reply = model(build_prompt(listed, violations, symbols, recorded_taste(codewatch, fragment)))
    except Exception as error:  # noqa: BLE001 - reported in stages.json; the brief is already written
        print(f"synthesis: model call failed: {type(error).__name__}: {error}", file=sys.stderr)
        return {**report, "items_out": 0, "outcome": "model_failed"}
    lines = cap_lines(tagged_lines(reply.text, listed, checkpoint))
    if lines:
        (codewatch / TASTE_DIR).mkdir(exist_ok=True)
        (codewatch / TASTE_DIR / fragment).write_text("".join(f"{line}\n" for line in lines))
    return {**report, "tokens": reply.tokens, "usd": reply.usd, "items_out": len(lines),
            "outcome": "written" if lines else "empty_reply"}


def write_pr_report(workspace: Path, check: dict | None) -> str:
    """`pr-report.json` beside the ratchet output; returns its markdown form."""
    config = read_json(workspace / CHECK_CONFIG) or {}
    rules = [r for r in config.get("rules") or [] if isinstance(r, dict)]
    report = pr_report(check, read_json(workspace / AUDIT / DIFF_OUT) if check else None, rules)
    (workspace / AUDIT).mkdir(parents=True, exist_ok=True)
    (workspace / AUDIT / PR_REPORT).write_text(json.dumps(report, indent=2) + "\n")
    return render_markdown(report)


def merge(repo: HiddenRepo, branch: str, markdown: str) -> dict:
    why = _on_pr_branch(repo, branch)
    if why:
        return {"outcome": "skipped", "reason": why}
    try:
        return merge_pr(repo, f"Merge {branch} into main\n\n{markdown}")
    except GitError as error:
        return {"outcome": "failed", "reason": str(error)}


def run_stage(workspace: Path, checkpoint: int, cli: Cli, model: Model, tool: Tool) -> dict:
    codewatch, repo, branch = workspace / ".codewatch", HiddenRepo.at(workspace), pr_branch(checkpoint)
    ratcheted = refresh_ratchet(repo, branch, tool)
    check = read_json(workspace / AUDIT / CHECK_OUT) if "items_in" in ratcheted else None
    verdicts = _guarded(lambda: read_verdicts(codewatch / "audit" / "verdicts.jsonl"), "verdicts")
    violations = new_violations(check)
    symbols = _guarded(lambda: changed_symbols(cli, workspace / DB, check), "changed symbols")
    codewatch.mkdir(exist_ok=True)
    brief = {"openItems": ratchet_items(violations), "changedSymbols": symbols}
    (codewatch / BRIEF).write_text(json.dumps(brief, indent=2) + "\n")
    markdown = write_pr_report(workspace, check)
    report = write_taste(codewatch, checkpoint, verdicts, violations, symbols, model)
    merged = merge(repo, branch, markdown)
    reasons = [r for r in (ratcheted.get("reason"), merged.get("reason")) if r]
    return {**report, "branch": branch, "baseline": ratcheted.get("baseline"), "merge": merged["outcome"],
            **({"merge_commit": merged["merge_commit"]} if "merge_commit" in merged else {}),
            **({"reason": "; ".join(reasons)} if reasons else {})}
