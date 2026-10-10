"""A real hidden repository for the fix stage tests; claude, codewatch and the reviewer are fakes.

The fixture models a workspace a real run has already touched: test runs have left bytecode,
caches and a virtualenv behind, and `next_checkpoint` puts a later checkpoint on the same
repository, so whatever an earlier stage run created there is still present.
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from prflow.repo import EXCLUDES
from remediation.fixer import Clock
from remediation.stage import Config, remediate

TESTS = ["python", "-m", "pytest", "-q", "tests"]
REVIEW = ["review"]
ENV = {"CW_MODEL": "sonnet-5.5", "PATH": os.environ.get("PATH", "")}


def git(root, *args):
    env = {**os.environ, "GIT_DIR": str(root / ".codewatch" / "repo.git"), "GIT_WORK_TREE": str(root),
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    done = subprocess.run(["git", *args], cwd=root, env=env, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {done.stderr}")
    return done.stdout.strip()


def leave_test_run_output(root):
    """What a real pytest run in the workspace leaves behind."""
    for path in ("src/__pycache__/app.cpython-312.pyc", "tests/__pycache__/test_app.cpython-312.pyc",
                 ".pytest_cache/v/cache/lastfailed", ".venv/bin/python"):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(b"\0")


def make_repo(root):
    """main holds the earlier checkpoint; cp-2 holds the solve, which changed src/app.py and its test."""
    for path, text in {"src/app.py": "x = 1\n", "src/old.py": "y = 1\n", "tests/test_app.py": "def test(): pass\n"}.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text)
    (root / ".codewatch").mkdir()
    (root / ".codewatch" / "taste.md").write_text("- prefer small functions\n")
    git(root, "init", "-q", "-b", "main")
    (root / ".codewatch" / "repo.git" / "info" / "exclude").write_text("".join(f"{p}\n" for p in EXCLUDES))
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "cp-1")
    git(root, "switch", "-q", "-c", "cp-2")
    (root / "src" / "app.py").write_text("x = 2\n")
    (root / "tests" / "test_app.py").write_text("def test(): assert True\n")
    git(root, "commit", "-qam", "solve cp-2")
    leave_test_run_output(root)


def next_checkpoint(root, n):
    """Lands cp-(n-1) on main and opens cp-n, whose solve changes src/app.py again."""
    git(root, "switch", "-q", "main")
    git(root, "merge", "-q", "--no-ff", "-m", f"land cp-{n - 1}", f"cp-{n - 1}")
    git(root, "switch", "-q", "-c", f"cp-{n}")
    (root / "src" / "app.py").write_text(f"x = {n * 10}\n")
    git(root, "commit", "-qam", f"solve cp-{n}")
    write_verdicts(root, [])


def write_verdicts(root, rows, triage=None):
    audit = root / ".codewatch" / "audit"
    audit.mkdir(parents=True, exist_ok=True)
    (audit / "verdicts.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    if triage is not None:
        (audit / "triage.json").write_text(json.dumps(triage))


def confirmed(signal="symbol-cognitive", path="src/app.py"):
    return {"key": f"{signal}:{path}", "signal": signal, "path": path, "verdict": "confirmed", "rationale": "r",
            "citations": [{"path": path, "lineStart": 1, "lineEnd": 1, "quote": "q"}], "controlRun": "ok"}


def writes(path, text):
    def edit(root):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text)
    return edit


class FakeClaude:
    """Applies one edit per call and answers with a stream-json result event."""

    def __init__(self, *edits, timeout_on=None, error=None):
        self.edits, self.timeout_on, self.error = list(edits), timeout_on, error
        self.calls = []

    def __call__(self, argv, env, cwd, timeout):
        self.calls.append(list(argv))
        if self.edits and (edit := self.edits.pop(0)):
            edit(Path(cwd))
        if self.error:
            raise self.error
        flag = "--resume" if "--resume" in argv else "--session-id"
        result = {"type": "result", "subtype": "success", "num_turns": 3, "total_cost_usd": 0.1,
                  "session_id": argv[argv.index(flag) + 1], "usage": {"input_tokens": 10, "output_tokens": 5}}
        return (None, "", True) if len(self.calls) == self.timeout_on else (0, json.dumps(result), False)

    def prompts(self):
        return [argv[-1] for argv in self.calls]


class FakeTools:
    """Answers the test command, codewatch and the review command by argv."""

    def __init__(self, tests=(), violations=(), diff=None, reviews=()):
        self.tests, self.violations, self.reviews = list(tests), list(violations), list(reviews)
        self.diff = diff or {}
        self.calls = []
        self.snapshot_id = 0

    def __call__(self, argv, env, cwd, timeout):
        argv = list(argv)
        self.calls.append(argv)
        if argv == TESTS:
            leave_test_run_output(Path(cwd))
            return (self.tests.pop(0) if self.tests else 0), "", False
        if argv[:1] == REVIEW:
            return 0, json.dumps(self.reviews.pop(0) if self.reviews else {"verdict": "ok"}), False
        if argv[1:3] == ["graph", "check"]:
            return self._check()
        if argv[1:3] == ["graph", "diff"]:
            return 0, json.dumps({"diff": self.diff}), False
        return 0, "", False

    def _check(self):
        self.snapshot_id += 1
        names = self.violations.pop(0) if self.violations else []
        violations = [{"ruleId": "max-cc", "nodeId": n, "isCarryover": False} for n in names]
        return 1 if names else 0, json.dumps({"snapshot": {"id": self.snapshot_id},
                                              "result": {"violations": violations}}), False


class StageTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "workspace"
        self.root.mkdir()
        make_repo(self.root)
        self.config = Config(
            workspace=self.root, scratch=Path(tmp.name) / "scratch", git_dir=self.root / ".codewatch" / "repo.git",
            codewatch="codewatch", db=".codewatch/cache/graph.db", check_config=".codewatch/check.json",
            baseline=None, tests_dir="tests", test_command=TESTS, review_command=REVIEW, deadline=None,
            reset_margin=60)

    def run_stage(self, claude, tools, config=None, clock=None):
        return remediate(config or self.config, ENV, claude, tools, clock or Clock(None, 60))

    def log(self, *args):
        return git(self.root, "log", "--format=%s", *args).splitlines()


