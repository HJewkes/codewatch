"""The upstream and select commands: exclusions from SCBench references, then the pinned corpus."""

from __future__ import annotations

import ast
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from calibration import fetch
from calibration.corpus import Stats, excluded_name, github_repo, match_tag, python_share, rejection, \
    upstream_names
from calibration.measure import measure_project
from calibration.production import excluded_path
from regrade.holdout import holdout_problems

CUTOFF = datetime(2026, 10, 20, tzinfo=timezone.utc)
REPO_LOCKS: dict[str, threading.Lock] = {}
# Well above SLOC_RANGE's top at ~40 bytes per line; skips parsing monorepos that would fail it anyway.
MAX_PRODUCTION_BYTES = 30_000_000


def _imports(path: Path) -> set[str]:
    try:
        tree = ast.parse(path.read_text(errors="replace"))
    except (SyntaxError, ValueError):
        return set()
    names = {a.name.split(".")[0] for x in ast.walk(tree) if isinstance(x, ast.Import) for a in x.names}
    return names | {x.module.split(".")[0] for x in ast.walk(tree)
                    if isinstance(x, ast.ImportFrom) and x.module and not x.level}


def cmd_upstream(args) -> int:
    """Never opens a holdout problem; reports counts only."""
    held = holdout_problems()
    problems = sorted(p for p in Path(args.problems).iterdir() if p.is_dir())
    opened = [p for p in problems if p.name not in held]
    files = [f for p in opened for f in (p / "solutions").rglob("*.py")]
    local = {f.stem for f in files} | {d.name for f in files for d in f.parents}
    names = upstream_names(set().union(*map(_imports, files)), local, frozenset(sys.stdlib_module_names))
    Path(args.out).write_text(json.dumps(sorted(names), indent=1) + "\n")
    print(f"{len(opened)} of {len(problems)} problems read ({len(problems) - len(opened)} held out), "
          f"{len(files)} files, {len(names)} upstream names")
    return 0


def evaluate(name: str, upstream: frozenset[str], cache: Path) -> dict:
    """One candidate's decision: a manifest row with its raw measures saved, or a rejection reason."""
    if excluded_name(name, upstream):
        return {"project": name, "rejected": "excluded"}
    info = fetch.pypi_info(name)
    repo = github_repo(info)
    if not repo:
        return {"project": name, "rejected": "no GitHub link"}
    repo, fork, archived = fetch.github_page(repo)
    if fork or archived:
        return {"project": name, "repo": repo, "rejected": "fork" if fork else "archived"}
    with REPO_LOCKS.setdefault(repo, threading.Lock()):
        path = fetch.clone(repo, cache)
        tag = match_tag(fetch.tags(path), name, info["version"])
        if not tag:
            return {"project": name, "repo": repo, "rejected": f"no tag for {info['version']}"}
        return _pinned(name, repo, info["version"], tag, path, cache)


def _pinned(name: str, repo: str, version: str, tag: str, path: Path, cache: Path) -> dict:
    sha = fetch.commit_of(path, tag)
    commits, authors, days = fetch.history(path, sha, CUTOFF)
    row = {"project": name, "version": version, "tag": tag, "sha": sha, "repo": f"https://github.com/{repo}",
           "commits": commits, "authors": authors, "days_since_commit": days}
    early = rejection(Stats(False, False, 1.0, commits, authors, days, 2_000))
    if early:
        return {**row, "rejected": early}
    fetch.checkout(path, sha)
    sizes = fetch.file_sizes(path)
    share = python_share(sizes)
    row["python_share"] = round(share, 3)
    if rejection(Stats(False, False, share, commits, authors, days, 2_000)):
        return {**row, "rejected": rejection(Stats(False, False, share, commits, authors, days, 2_000))}
    py_bytes = sum(s for p, s in sizes.items() if p.endswith(".py") and not excluded_path(tuple(p.split("/"))))
    if py_bytes > MAX_PRODUCTION_BYTES:
        return {**row, "rejected": f"production .py bytes {py_bytes}"}
    measured = measure_project(path)
    row["sloc"], row["files"] = measured["sloc"], measured["files"]
    reason = rejection(Stats(False, False, share, commits, authors, days, measured["sloc"]))
    if not reason:
        (cache / "raw").mkdir(exist_ok=True)
        (cache / "raw" / f"{name}.json").write_text(json.dumps({**measured, "project": name, "sha": sha}))
    return {**row, "rejected": reason} if reason else row


def _safe(name: str, upstream: frozenset[str], cache: Path) -> dict:
    try:
        return evaluate(name, upstream, cache)
    except Exception as error:  # a network or git failure rejects the candidate, it does not stop the run
        return {"project": name, "rejected": f"error {type(error).__name__}: {str(error)[:120]}"}


def _decisions(cache: Path, names: list[str], upstream: frozenset[str], jobs: int) -> list[dict]:
    log = cache / "decisions.jsonl"
    done = {d["project"]: d for d in map(json.loads, log.read_text().splitlines())} if log.exists() else {}
    todo = [n for n in names if n not in done or done[n].get("rejected", "").startswith("error")]
    with ThreadPoolExecutor(jobs) as pool, log.open("a") as out:
        for decision in pool.map(lambda n: _safe(n, upstream, cache), todo):
            done[decision["project"]] = decision
            out.write(json.dumps(decision) + "\n")
            out.flush()
    return [done[n] for n in names]


def cmd_select(args) -> int:
    ranked = [r["project"] for r in json.loads(Path(args.top).read_text())["rows"]][:args.limit]
    upstream = frozenset(json.loads(Path(args.upstream).read_text()))
    cache = Path(args.cache)
    decisions = _decisions(cache, ranked, upstream, args.jobs)
    accepted, repos = [], set()
    for d in decisions:
        if not d.get("rejected") and d["repo"] not in repos and len(accepted) < args.target:
            accepted.append({k: d[k] for k in ("project", "version", "tag", "sha", "repo", "sloc", "files",
                                               "python_share", "commits", "authors", "days_since_commit")})
            repos.add(d["repo"])
    manifest = {"cutoff": CUTOFF.date().isoformat(), "candidates": len(ranked), "projects": accepted,
                "sloc": sum(p["sloc"] for p in accepted), "excluded_upstream": sorted(upstream)}
    Path(args.manifest).write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{len(accepted)} projects, {manifest['sloc']} SLOC, from {len(ranked)} candidates")
    return 0
