"""C-264 S1: rebuild a run's fix history from `stages.json` and the fix-reviewer transcripts.

The workspace git of an A1 run is not kept, so each kept fix commit's diff is read back
from the prompt its reviewer was given (`review/verdict.py`, `build_prompt`). Reviewer
transcripts are joined to the kept items in enqueue order; each pair must agree on the
reviewer's reason, and a test-gap item's diff must touch only `tests/`. Quality items
may touch tests too (a clone fix merges test helpers), so their side is not checked. Reverse-applying a checkpoint's diffs to `snapshot/` gives the pre-fix
tree; forward-applying them again must reproduce `snapshot/` byte for byte.

Usage: python3 -m c264.rebuild --out DIR RUN/<problem> [RUN/<problem> ...]
"""

from __future__ import annotations

import argparse
import filecmp
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

PROMPT_HEAD = "Does this commit change behaviour"
DIFF_MARK = "\n\nCommit diff:\n"
CUT_MARK = "[diff cut here:"
TESTS_DIR = "tests"
TEST_GAP = "test-gap"
FILE_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$", re.MULTILINE)
CHECKPOINT = re.compile(r"^checkpoint_(\d+)$")
TRANSCRIPTS = Path("agent/workspace/projects/-workspace")


class RebuildError(RuntimeError):
    pass


@dataclass(frozen=True)
class Review:
    session: str
    enqueued: str
    diff: str
    reason: str | None


def fix_items(stages: Path) -> list[dict]:
    """The kept items of the fix stage, in the order the stage worked them."""
    record = json.loads(stages.read_text(encoding="utf-8"))
    fixes = [s for s in record["stages"] if s.get("stage") == "fix"]
    return [i for s in fixes for i in s.get("items", []) if i.get("status") == "kept"]


def prompt_diff(prompt: str) -> str:
    """The diff `build_prompt` placed last, without the newline it appended."""
    start = prompt.find(DIFF_MARK)
    if start < 0:
        raise RebuildError("reviewer prompt has no commit diff")
    diff = prompt[start + len(DIFF_MARK):-1]
    if CUT_MARK in diff[-200:]:
        raise RebuildError("reviewer prompt holds a cut diff")
    return diff


def reply_reason(records: list[dict]) -> str | None:
    """The reason in the reviewer's JSON reply; a thinking-only record carries no text."""
    for record in records:
        if record.get("type") != "assistant":
            continue
        text = "".join(b.get("text", "") for b in record["message"].get("content", []))
        if not text.strip():
            continue
        start, end = text.find("{"), text.rfind("}")
        try:
            return json.loads(text[start:end + 1]).get("reason")
        except (json.JSONDecodeError, AttributeError):
            return None
    return None


def parse_line(line: str) -> dict | None:
    """A record, or None for a blank line or one cut off when its run was stopped."""
    try:
        return json.loads(line) if line.strip() else None
    except json.JSONDecodeError:
        return None


def read_review(path: Path) -> Review | None:
    """The transcript's review, or None when it is not a fix-reviewer transcript."""
    lines = path.read_text(encoding="utf-8").split("\n")  # splitlines() would also split at U+2028 in a diff
    records = [r for r in map(parse_line, lines) if r]
    prompt = next((r for r in records if r.get("type") == "user"
                   and str(r["message"].get("content", "")).startswith(PROMPT_HEAD)), None)
    if prompt is None:
        return None
    content = prompt["message"]["content"]
    return Review(prompt["sessionId"], prompt["timestamp"], prompt_diff(content), reply_reason(records))


def read_reviews(directory: Path) -> list[Review]:
    reviews = [read_review(p) for p in sorted(directory.glob("*.jsonl"))]
    return sorted((r for r in reviews if r is not None), key=lambda r: r.enqueued)


def diff_paths(diff: str) -> list[str]:
    return [m.group(2) for m in FILE_HEADER.finditer(diff)]


def check_pair(item: dict, review: Review) -> None:
    expected = (item.get("review") or {}).get("reason")
    if expected != review.reason:
        raise RebuildError(f"{item['symbol']}: reviewer reason differs in {review.session}")
    paths = diff_paths(review.diff)
    in_tests = [p.split("/", 1)[0] == TESTS_DIR for p in paths]
    if not paths or (item["kind"] == TEST_GAP and not all(in_tests)):
        raise RebuildError(f"{item['symbol']}: {item['kind']} diff touches {paths}")


def join(items: list[dict], reviews: list[Review]) -> list[tuple[dict, Review]]:
    """Pair the kept items with the reviews, both in the order the stage made them."""
    if len(items) != len(reviews):
        raise RebuildError(f"{len(items)} kept items but {len(reviews)} reviewer transcripts")
    pairs = list(zip(items, reviews))
    for item, review in pairs:
        check_pair(item, review)
    return pairs


def git_apply(tree: Path, diff: str, reverse: bool) -> None:
    env = {**os.environ, "GIT_CEILING_DIRECTORIES": str(tree.resolve().parent)}
    args = ["git", "apply", "--whitespace=nowarn", *(["-R"] if reverse else []), "-"]
    done = subprocess.run(args, cwd=tree, input=diff.encode("utf-8"), capture_output=True, env=env, check=False)
    if done.returncode != 0:
        raise RebuildError(f"git apply{' -R' if reverse else ''} in {tree}: {done.stderr.decode().strip()}")


def tree_files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def tree_differences(left: Path, right: Path) -> list[str]:
    """Relative paths present on one side only, or whose bytes differ."""
    ours, theirs = tree_files(left), tree_files(right)
    both = ours & theirs
    changed = [p for p in both if not filecmp.cmp(left / p, right / p, shallow=False)]
    return sorted((ours ^ theirs) | set(changed))


def rebuild_base(snapshot: Path, diffs: list[str], base: Path) -> list[str]:
    """Write the pre-fix tree to `base`; return the forward check's differences from `snapshot`."""
    shutil.copytree(snapshot, base)
    for diff in reversed(diffs):
        git_apply(base, diff, reverse=True)
    with tempfile.TemporaryDirectory() as scratch:
        forward = Path(scratch) / "tree"
        shutil.copytree(base, forward)
        for diff in diffs:
            git_apply(forward, diff, reverse=False)
        return tree_differences(forward, snapshot)


def fresh(path: Path) -> Path:
    if path.exists():
        shutil.rmtree(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_diffs(pairs: list[tuple[dict, Review]], directory: Path) -> list[Path]:
    fresh(directory).mkdir()
    paths = [directory / f"{order:02d}.diff" for order in range(1, len(pairs) + 1)]
    for path, (_, review) in zip(paths, pairs):
        path.write_text(review.diff, encoding="utf-8")
    return paths


def row(problem: str, cp: int, order: int, item: dict, review: Review, diff: Path, out: Path) -> dict:
    return {"problem": problem, "cp": cp, "order": order, "kind": item["kind"],
            "signal": item.get("signal"), "symbol": item.get("symbol"), "path": item.get("path"),
            "commit": item.get("commit"), "session": review.session, "files": diff_paths(review.diff),
            "diff": diff.relative_to(out).as_posix()}


def rebuild_checkpoint(problem: str, cp: int, cp_dir: Path, out: Path) -> list[dict]:
    pairs = join(fix_items(cp_dir / "agent" / "stages.json"), read_reviews(cp_dir / TRANSCRIPTS))
    diff_files = write_diffs(pairs, out / "diffs" / problem / f"cp{cp}")
    base = fresh(out / "base" / problem / f"cp{cp}")
    differences = rebuild_base(cp_dir / "snapshot", [r.diff for _, r in pairs], base)
    if differences:
        raise RebuildError(f"{problem} cp{cp}: forward check differs from snapshot/ at {differences[:5]}")
    return [row(problem, cp, n, item, review, diff, out)
            for n, ((item, review), diff) in enumerate(zip(pairs, diff_files), start=1)]


def checkpoints(problem_dir: Path) -> list[tuple[int, Path]]:
    found = [(int(m.group(1)), p) for p in problem_dir.iterdir() if (m := CHECKPOINT.match(p.name))]
    return sorted(found)


def summary(rows: list[dict], cps: int) -> str:
    kinds = Counter(r["kind"] for r in rows)
    signals = Counter(r["signal"] for r in rows if r["kind"] == TEST_GAP)
    quality_in_tests = sum(r["kind"] != TEST_GAP and any(f.startswith(f"{TESTS_DIR}/") for f in r["files"])
                           for r in rows)
    lines = [f"{cps} checkpoints round-trip byte for byte to snapshot/", f"{len(rows)} kept items: {dict(kinds)}",
             f"  non-test-gap items touching {TESTS_DIR}/: {quality_in_tests}"]
    return "\n".join(lines + [f"  test-gap {signal}: {n}" for signal, n in signals.most_common()])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="output directory, outside the repo")
    parser.add_argument("problems", type=Path, nargs="+", help="a run's <problem> directory")
    args = parser.parse_args(argv)
    rows, cps = [], 0
    try:
        for problem_dir in args.problems:
            for cp, cp_dir in checkpoints(problem_dir):
                rows += rebuild_checkpoint(problem_dir.name, cp, cp_dir, args.out)
                cps += 1
    except RebuildError as error:
        print(f"rebuild failed: {error}", file=sys.stderr)
        return 1
    (args.out / "items.json").write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
    print(summary(rows, cps))
    return 0


if __name__ == "__main__":
    sys.exit(main())
