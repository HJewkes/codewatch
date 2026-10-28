"""C-264 S2: the replay's metrics, M1-M3 and M5, read from each arm's hidden repository.

- M1: lines under tests/ that `git blame` gives to a test-gap commit (all such lines, and
  those inside a test function's span only), and the `--numstat` lines those commits added.
- M2: test:source ratio as `c239/report.py`'s `test_bloat` computes it, plus raw `wc -l`.
- M3: `test_bloat`'s near-duplicate share, and the share of tests whose covered source lines
  equal another test's (from one coverage run with per-test contexts, `contexts`).
- M5: the tests that alone cover some source line.

    python3 -m c264.metrics contexts TREE OUT.json     # inside the A1 image, venv in TREE
    python3 -m c264.metrics measure REPO_WS REF TREE    # prints one JSON row
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from c239.report import body_shape, src_lines
from c239.scan import functions, tests
from findings.diff_uncovered import AGENT_VENVS, agent_test_env
from remediation.git import Git

from .rebuild import TEST_GAP, TESTS_DIR
from .strip import spans

COVERAGE = "/opt/codewatch-a1/bin/coverage"
PYTEST = ("-m", "pytest", "-q", "-p", "no:cacheprovider", TESTS_DIR)


def test_files(tree: Path) -> list[Path]:
    return sorted((tree / TESTS_DIR).rglob("*.py"))


def wc(path: Path) -> int:
    return path.read_bytes().count(b"\n")


def subjects(git: Git, ref: str) -> dict[str, str]:
    log = git.run("log", "--format=%H %s", ref)
    return dict(line.split(" ", 1) for line in log.splitlines())


def blame_lines(git: Git, ref: str, path: str) -> list[str]:
    """The commit of each line of `path` at `ref`."""
    out = git.run("blame", "-w", "-M", "-C", "--porcelain", ref, "--", path)
    shas, expect = [], True
    for line in out.split("\n"):
        if expect and line[:40].isalnum() and len(line.split()) >= 3:
            shas.append(line[:40])
            expect = False
        elif line.startswith("\t"):
            expect = True
    return shas


def test_spans(source: str) -> set[int]:
    lines = set()
    for tail, (start, end) in spans(source).items():
        if tail.rsplit("::", 1)[-1].startswith("test"):
            lines |= set(range(start, end + 1))
    return lines


def m1(git: Git, ref: str, tree: Path) -> dict:
    subject = subjects(git, ref)
    gap = {sha for sha, s in subject.items() if s.startswith(TEST_GAP)}
    attributed = span_only = 0
    for file in test_files(tree):
        rel = file.relative_to(tree).as_posix()
        inside = test_spans(file.read_text(encoding="utf-8", errors="replace"))
        for number, sha in enumerate(blame_lines(git, ref, rel), start=1):
            attributed += sha in gap
            span_only += sha in gap and number in inside
    return {"test_gap_lines": attributed, "test_gap_span_lines": span_only, "test_gap_numstat": numstat(git, ref, gap)}


def numstat(git: Git, ref: str, gap: set[str]) -> int:
    added, current = 0, None
    for line in git.run("log", "--format=@%H", "--numstat", ref).splitlines():
        if line.startswith("@"):
            current = line[1:]
        elif line and current in gap:
            plus, _, path = line.split("\t", 2)
            added += int(plus) if plus.isdigit() and path.startswith(f"{TESTS_DIR}/") else 0
    return added


def m2_m3(tree: Path) -> dict:
    head, ts = functions(tree), tests(tree)
    test_loc = sum(t.text.count("\n") + 1 for t in ts)
    shapes = Counter(body_shape(t.text) for t in ts)
    entry = next(p for p in sorted(tree.glob("*.py")))
    return {"tests": len(ts), "test_source_ratio": round(test_loc / max(src_lines(head), 1), 2),
            "near_duplicate": round(sum(n - 1 for n in shapes.values() if n > 1) / max(len(ts), 1), 3),
            "test_lines_wc": sum(wc(f) for f in test_files(tree)), "entry_lines_wc": wc(entry)}


def context_lines(report: dict, tree: Path) -> dict[str, frozenset[str]]:
    """Each test context's covered source lines; tests and the venv do not count."""
    per_test: dict[str, set[str]] = defaultdict(set)
    for name, data in report.get("files", {}).items():
        rel = Path(name).resolve().relative_to(tree.resolve()).as_posix() if Path(name).is_absolute() else name
        if rel.startswith((f"{TESTS_DIR}/", *(f"{v}/" for v in AGENT_VENVS))):
            continue
        for line, names in data.get("contexts", {}).items():
            for context in filter(None, names):
                per_test[context].add(f"{rel}:{line}")
    return {k: frozenset(v) for k, v in per_test.items()}


def coverage_shape(per_test: dict[str, frozenset[str]]) -> dict:
    counts = Counter(per_test.values())
    owners: dict[str, list[str]] = defaultdict(list)
    for test, lines in per_test.items():
        for line in lines:
            owners[line].append(test)
    unique = sorted({tests_[0] for tests_ in owners.values() if len(tests_) == 1})
    identical = sum(1 for lines in per_test.values() if counts[lines] > 1)
    return {"contexts": len(per_test), "coverage_identical": round(identical / max(len(per_test), 1), 3),
            "unique_line_tests": unique}


def run_contexts(tree: Path, out: Path, coverage: str) -> int:
    scratch = out.parent / f"{out.stem}.scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    rc = scratch / "coveragerc"
    rc.write_text(f"[run]\nbranch = true\ndynamic_context = test_function\ndata_file = {scratch / '.coverage'}\n")
    env = agent_test_env(tree, scratch)
    subprocess.run([coverage, "run", f"--rcfile={rc}", *PYTEST], cwd=tree, env=env, capture_output=True, check=False)
    raw = scratch / "coverage.json"
    subprocess.run([coverage, "json", f"--rcfile={rc}", "--show-contexts", "-o", str(raw)], cwd=tree, env=env,
                   capture_output=True, check=True)
    shape = coverage_shape(context_lines(json.loads(raw.read_text()), tree))
    out.write_text(json.dumps(shape, indent=1) + "\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    ctx = sub.add_parser("contexts")
    ctx.add_argument("tree", type=Path)
    ctx.add_argument("out", type=Path)
    ctx.add_argument("--coverage", default=COVERAGE)
    measure = sub.add_parser("measure")
    measure.add_argument("workspace", type=Path)
    measure.add_argument("ref")
    measure.add_argument("tree", type=Path)
    args = parser.parse_args(argv)
    if args.command == "contexts":
        return run_contexts(args.tree, args.out, args.coverage)
    git = Git(args.workspace, args.workspace / ".codewatch" / "repo.git")
    print(json.dumps({**m1(git, args.ref, args.tree), **m2_m3(args.tree)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
