"""PR-flow stage tests on a real git repository in a scratch workspace, with codewatch faked."""

from __future__ import annotations

import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from prflow.__main__ import main
from prflow.pr import merge_pr, pr_open, repo_init
from prflow.ratchet import AUDIT, CHECK_CONFIG, CHECK_OUT, DIFF_OUT, NO_REV, commit_ratchet
from prflow.repo import GIT_DIR, HiddenRepo

CHECK = {"result": {"violations": [{"ruleId": "max-file-loc", "nodeId": "app.py"},
                                   {"ruleId": "max-file-loc", "nodeId": "old.py", "isCarryover": True}]}}
DIFF = {"changes": [{"nodeId": "app.py", "status": "added"}]}


def _done(args: list[str], code: int = 0, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args, code, stdout, stderr)


class FakeCodewatch:
    def __init__(self, has_rev: bool = True, init_fails: bool = False) -> None:
        self.has_rev, self.init_fails = has_rev, init_fails
        self.calls: list[list[str]] = []
        self.envs: list[dict] = []

    def __call__(self, args: list[str], env, cwd: Path) -> subprocess.CompletedProcess:
        self.calls.append(args)
        self.envs.append(dict(env))
        if args[:2] == ["graph", "init"]:
            return self._init(args, cwd)
        if "--help" in args:
            return _done(args, stdout="--ref <ref>\n" + ("--rev <rev>\n" if self.has_rev else ""))
        if args[:2] == ["graph", "check"]:
            return _done(args, 1, json.dumps(CHECK))
        if args[:2] == ["graph", "diff"]:
            return _done(args, 0, json.dumps(DIFF))
        return _done(args)

    def _init(self, args: list[str], cwd: Path) -> subprocess.CompletedProcess:
        if self.init_fails:
            return _done(args, 1, stderr="error: cannot write config")
        (cwd / CHECK_CONFIG).write_text('{"rules": []}\n')
        return _done(args)

    def index_calls(self) -> list[list[str]]:
        return [c for c in self.calls if c[:2] == ["graph", "index"] and "--help" not in c]


class RepoTestCase(unittest.TestCase):
    def setUp(self) -> None:
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        isolated = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        patcher = mock.patch.dict(os.environ, isolated)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = HiddenRepo.at(self.workspace)
        self.codewatch = FakeCodewatch()

    def write(self, rel: str, text: str = "x = 1\n") -> None:
        path = self.workspace / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def tracked(self, ref: str = "HEAD") -> set[str]:
        return set(self.repo.run("ls-tree", "-r", "--name-only", ref).splitlines())

    def subjects(self, ref: str) -> list[str]:
        return self.repo.run("log", "--topo-order", "--reverse", "--format=%s", ref).splitlines()

    def checkpoint(self, n: int, files: dict[str, str]) -> dict:
        pr_open(self.repo, n)
        for rel, text in files.items():
            self.write(rel, text)
        return commit_ratchet(self.repo, n, self.codewatch)


class RepoInitTest(RepoTestCase):
    def test_creates_the_hidden_repo_with_a_main_that_holds_only_the_check_config(self):
        self.write("starter.py")

        report = repo_init(self.repo, self.codewatch)

        self.assertEqual(report, {"outcome": "created"})
        self.assertTrue((self.workspace / GIT_DIR / "HEAD").is_file())
        self.assertEqual(self.repo.run("config", "core.worktree"), str(self.workspace.resolve()))
        self.assertEqual(self.repo.branch(), "main")
        self.assertEqual(self.subjects("main"), ["repo-init: codewatch config"])
        self.assertEqual(self.tracked(), {".codewatch/check.json"})

    def test_the_solve_environment_has_no_git_dir_and_no_dot_git(self):
        repo_init(self.repo, self.codewatch)
        solve_env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_DIR")}
        solve_env["GIT_CEILING_DIRECTORIES"] = str(self.root.resolve())

        found = subprocess.run(["git", "rev-parse", "--git-dir"], cwd=self.workspace, env=solve_env,
                               capture_output=True, text=True, check=False)

        self.assertFalse((self.workspace / ".git").exists())
        self.assertNotIn("GIT_DIR", solve_env)
        self.assertNotEqual(found.returncode, 0, found.stdout)

    def test_info_exclude_keeps_the_repo_cache_and_audit_out_of_every_commit(self):
        repo_init(self.repo, self.codewatch)
        exclude = (self.workspace / GIT_DIR / "info" / "exclude").read_text().splitlines()
        for rel in (".codewatch/cache/graph.db", ".codewatch/audit/findings.jsonl", ".venv/bin/python",
                    ".codewatch/taste.md", "app.py"):
            self.write(rel)

        self.checkpoint(1, {})

        for pattern in ("/.codewatch/repo.git/", "/.codewatch/cache/", "/.codewatch/audit/"):
            self.assertIn(pattern, exclude)
        self.assertEqual(self.tracked(), {".codewatch/check.json", ".codewatch/taste.md", "app.py"})

    def test_a_second_run_is_a_no_op(self):
        repo_init(self.repo, self.codewatch)

        report = repo_init(self.repo, self.codewatch)

        self.assertEqual(report, {"outcome": "exists"})
        self.assertEqual(len(self.subjects("main")), 1)

    def test_a_failed_graph_init_still_creates_an_empty_main_and_says_why(self):
        report = repo_init(self.repo, FakeCodewatch(init_fails=True))

        self.assertEqual(report["outcome"], "created")
        self.assertIn("graph init exited 1: error: cannot write config", report["reason"])
        self.assertEqual(self.tracked(), set())


class CommitRatchetTest(RepoTestCase):
    def setUp(self) -> None:
        super().setUp()
        repo_init(self.repo, self.codewatch)
        self.main_root = self.repo.rev("main")

    def test_commits_the_solve_and_ratchets_it_against_the_merge_base(self):
        report = self.checkpoint(1, {"app.py": "def run():\n    return 1\n"})

        solve = self.repo.rev("cp-1")
        self.assertEqual(self.subjects("cp-1")[-1], "cp-1: solve")
        self.assertEqual((report["outcome"], report["solve_commit"], report["merge_base"]),
                         ("ok", solve, self.main_root))
        self.assertEqual(self.codewatch.index_calls(), [
            ["graph", "index", ".", "--db", ".codewatch/cache/graph.db", "--ref", "cw-head-cp-1", "--json",
             "--rev", solve],
            ["graph", "index", ".", "--db", ".codewatch/cache/graph.db", "--ref", "cw-merge-base-cp-1",
             "--json", "--rev", self.main_root],
        ])
        check = next(c for c in self.codewatch.calls if c[:2] == ["graph", "check"])
        self.assertEqual(check[check.index("--baseline") + 1], "cw-merge-base-cp-1")
        self.assertEqual((report["baseline"], report["items_in"], report["items_out"]), ("cw-merge-base-cp-1", 2, 1))
        self.assertNotIn("reason", report)
        self.assertEqual(json.loads((self.workspace / AUDIT / CHECK_OUT).read_text()), CHECK)
        self.assertEqual(json.loads((self.workspace / AUDIT / DIFF_OUT).read_text()), DIFF)
        self.assertTrue(all(env["GIT_DIR"] == str(self.workspace / GIT_DIR) for env in self.codewatch.envs))

    def test_without_graph_index_rev_it_checks_the_work_tree_with_no_baseline_and_says_why(self):
        self.codewatch = FakeCodewatch(has_rev=False)

        report = self.checkpoint(1, {"app.py": "x = 1\n"})

        self.assertEqual(self.codewatch.index_calls(), [
            ["graph", "index", ".", "--db", ".codewatch/cache/graph.db", "--ref", "cw-head-cp-1", "--json"],
        ])
        check = next(c for c in self.codewatch.calls if c[:2] == ["graph", "check"])
        self.assertNotIn("--baseline", check)
        self.assertEqual((report["outcome"], report["baseline"], report["reason"]), ("ok", None, NO_REV))
        self.assertTrue((self.workspace / AUDIT / CHECK_OUT).is_file())
        self.assertFalse((self.workspace / AUDIT / DIFF_OUT).exists())

    def test_skips_without_committing_when_pr_open_did_not_run(self):
        self.write("app.py")

        report = commit_ratchet(self.repo, 1, self.codewatch)

        self.assertEqual(report["outcome"], "skipped")
        self.assertIn("not cp-1", report["reason"])
        self.assertEqual(self.subjects("main"), ["repo-init: codewatch config"])


class PrFlowTest(RepoTestCase):
    def setUp(self) -> None:
        super().setUp()
        repo_init(self.repo, self.codewatch)

    def _fix_merge_fold(self, n: int) -> None:
        """Stand-ins for the fix stage's commit and the merging job's fold commit."""
        self.write(f"tests/test_cp{n}.py", "def test_ok():\n    assert True\n")
        self.repo.commit_all(f"cp-{n}: fix")
        self.assertEqual(merge_pr(self.repo, f"Merge cp-{n} into main")["outcome"], "merged")
        self.write(".codewatch/taste.md", f"- folded through cp-{n}\n")
        self.repo.commit_all(f"fold cp-{n}")

    def test_two_checkpoints_leave_solve_fix_merge_and_fold_on_main_in_order(self):
        for n in (1, 2):
            self.checkpoint(n, {f"app_{n}.py": f"N = {n}\n"})
            self._fix_merge_fold(n)

        self.assertEqual(self.subjects("main"), [
            "repo-init: codewatch config",
            "cp-1: solve", "cp-1: fix", "Merge cp-1 into main", "fold cp-1",
            "cp-2: solve", "cp-2: fix", "Merge cp-2 into main", "fold cp-2",
        ])
        self.assertEqual(self.repo.run("rev-list", "--count", "--merges", "main"), "2")
        self.assertEqual(self.repo.merge_base(), self.repo.rev("main"))
        self.assertFalse(self.repo.dirty())

    def test_pr_open_merges_a_branch_no_stage_merged_and_leaves_the_work_tree_alone(self):
        self.checkpoint(1, {"app.py": "N = 1\n"})
        self.write("NOTES.md", "left after the last commit\n")

        report = pr_open(self.repo, 2)

        self.assertEqual((report["outcome"], report["branch"]), ("opened", "cp-2"))
        self.assertIn("merged cp-1", report["reason"])
        self.assertEqual(self.repo.branch(), "cp-2")
        self.assertEqual(self.repo.rev("cp-2"), self.repo.rev("main"))
        self.assertEqual(self.subjects("main")[-2:], ["cp-1: stage output left uncommitted", "Merge cp-1 into main"])
        self.assertEqual((self.workspace / "NOTES.md").read_text(), "left after the last commit\n")
        self.assertFalse(self.repo.dirty())

    def test_pr_open_twice_on_one_checkpoint_keeps_the_open_branch(self):
        pr_open(self.repo, 1)
        self.write("app.py")

        report = pr_open(self.repo, 1)

        self.assertEqual(report, {"outcome": "already-open", "branch": "cp-1"})
        self.assertTrue(self.repo.dirty())


class CommandTest(unittest.TestCase):
    def test_a_stage_without_a_hidden_repo_reports_why_and_exits_non_zero(self):
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(io.StringIO()) as out:
            code = main(["pr-open", "--workspace", tmp, "--checkpoint", "2"])

        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.getvalue().splitlines()[-1])["outcome"], "skipped")


if __name__ == "__main__":
    unittest.main()
