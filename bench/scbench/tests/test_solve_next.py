import contextlib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from regrade import holdout
from solvenext import parity, plan, record
from solvenext.__main__ import main

try:
    import jinja2
except ModuleNotFoundError:
    jinja2 = None

HERE = Path(__file__).parent
SCRIPT = HERE.parent / "c239" / "harness" / "solve_next.sh"
HELD = "held_problem"
PROBLEM = "word_counter"
CONFIG = """entry_file: wc
checkpoints:
  checkpoint_1: {order: 1}
  checkpoint_2: {order: 2}
  checkpoint_3: {order: 3, include_prior_tests: false}
"""
SPEC = "<!-- canary 1234 -->\n# Word counter\n\nRun `%%%ENTRYPOINT:entry_command%%% FILE` from %%%ENTRYPOINT:entry_file%%%.\n"


def evaluation(passed, total):
    return json.dumps({"pass_counts": {"Core": passed, "Regression": 0}, "total_counts": {"Core": total, "Regression": 0}})


def tree_digest(root):
    files = sorted(p for p in root.rglob("*") if p.is_file())
    return hashlib.sha256(b"".join(str(p.relative_to(root)).encode() + p.read_bytes() for p in files)).hexdigest()


class Fixture:
    """A synthetic home: holdout manifest, token file, problem catalog and a seed set."""

    def __init__(self, root: Path):
        self.home, self.seeds, self.problems = root / "home", root / "seeds", root / "problems"
        manifest = self.home / ".cache" / "codewatch-scbench" / "manifest.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps({"holdout": {"problems": {"Easy": [HELD]}}}))
        token = self.home / ".config" / "scbench" / "claude-oauth-token-server"
        token.parent.mkdir(parents=True)
        token.write_text("synthetic-token\n")
        for name in (PROBLEM, HELD):
            (self.problems / name).mkdir(parents=True)
            (self.problems / name / "config.yaml").write_text(CONFIG)
            (self.problems / name / "checkpoint_2.md").write_text(SPEC)
            cp1 = self.seed_cp(name)
            (cp1 / "snapshot").mkdir(parents=True)
            (cp1 / "snapshot" / "wc.py").write_text("print(0)\n")
            (cp1 / "evaluation.json").write_text(evaluation(8, 10))
            (cp1.parent / "checkpoint_2").mkdir()
            (cp1.parent / "checkpoint_2" / "evaluation.json").write_text(evaluation(15, 20))
        self.env = {**os.environ, "HOME": str(self.home), "SCBENCH_SEEDS": str(self.seeds),
                    "SCBENCH_PROBLEMS": str(self.problems)}
        self.env.pop(holdout.MILESTONE_ENV, None)

    def seed_cp(self, name=PROBLEM):
        return self.seeds / "c209-a1a" / name / "checkpoint_1"


class FakeRunner:
    """Stands in for docker: the solve writes into its workspace and a result event; eval writes a summary."""

    def __init__(self):
        self.calls = []

    def __call__(self, argv, **kwargs):
        self.calls.append(argv)
        if argv[0] == "docker":
            workspace = Path(argv[argv.index("-v") + 1].split(":")[0])
            (workspace / "wc.py").write_text("print(2)\n")
            kwargs["stdout"].write(json.dumps({"type": "result", "subtype": "success", "num_turns": 12,
                                               "total_cost_usd": 1.25, "duration_ms": 90000, "is_error": False}) + "\n")
        else:
            out = Path(argv[-1])
            out.mkdir(parents=True)
            (out / "summary.json").write_text(json.dumps({"passed": 16, "total": 20, "failed": []}))
        return subprocess.CompletedProcess(argv, 0)


class SolveNextRunTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self._tmp.name)
        self.fx = Fixture(self.root)
        self.out = self.root / "experiments" / "run1"
        patcher = mock.patch.dict(os.environ, self.fx.env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, *extra, problem=PROBLEM, tree=None, runner=None):
        argv = ["run", problem, "1", str(tree or self.fx.seed_cp(problem)), "--seed-set", "c209-a1a",
                "--out", str(self.out), *extra]
        return self.run_argv(argv, runner)

    def guard(self, problems):
        cache = self.fx.home / ".cache" / "codewatch-scbench"
        holdout.check(problems, None, cache / "manifest.json", cache / "climb" / "ledger.jsonl")

    def run_argv(self, argv, runner=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = main(argv, runner=runner or FakeRunner(), holdout_check=self.guard)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_script_refuses_a_holdout_problem_before_any_solve(self):
        result = subprocess.run(["bash", str(SCRIPT), HELD, "1", str(self.fx.seed_cp(HELD)), "--seed-set", "s",
                                 "--out", str(self.out)], capture_output=True, text=True, env=self.fx.env, check=False)
        self.assertEqual(result.returncode, holdout.REFUSED_EXIT, result.stderr)
        self.assertNotIn(HELD, result.stdout + result.stderr)
        self.assertFalse(self.out.exists())

    def test_python_entry_refuses_a_holdout_problem_before_calling_the_runner(self):
        runner = FakeRunner()
        code, out, err = self.run_main(problem=HELD, runner=runner)
        self.assertEqual(code, holdout.REFUSED_EXIT)
        self.assertEqual(runner.calls, [])
        self.assertNotIn(HELD, out + err)
        self.assertFalse(self.out.exists())

    def test_script_dry_run_prints_the_plan_and_writes_nothing(self):
        result = subprocess.run(["bash", str(SCRIPT), PROBLEM, "1", str(self.fx.seed_cp()), "--seed-set", "s",
                                 "--out", str(self.out), "--dry-run"], capture_output=True, text=True, env=self.fx.env, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("cp1 -> cp2", result.stdout)
        self.assertIn("--max-turns 100", result.stdout)
        self.assertIn(f"eval.sh {PROBLEM} 2 {self.out}/ws {self.out}/eval", result.stdout)
        self.assertIn(f"# outputs: {self.out}", result.stdout)
        self.assertNotIn("synthetic-token", result.stdout)
        self.assertFalse(self.out.exists())

    def test_solve_runs_on_a_copy_and_leaves_the_seed_untouched(self):
        seed = self.fx.seed_cp()
        before = tree_digest(seed)
        runner = FakeRunner()
        code, _, err = self.run_main(runner=runner)
        self.assertEqual(code, 0, err)
        self.assertEqual(tree_digest(seed), before)
        self.assertEqual((self.out / "ws" / "wc.py").read_text(), "print(2)\n")
        mounts = " ".join(runner.calls[0])
        self.assertIn(f"{self.out}/ws:/workspace", mounts)
        self.assertNotIn(str(self.fx.seeds), mounts)

    def test_run_json_records_pins_cost_and_rates(self):
        self.run_main()
        run = json.loads((self.out / "run.json").read_text())
        self.assertEqual(record.validate_run(run), [])
        self.assertEqual(run["pins"]["seed_set"], "c209-a1a")
        self.assertEqual(run["pins"]["model_id"], "claude-sonnet-5-5")
        self.assertEqual(run["cost"]["usd"], 1.25)
        self.assertEqual(run["cost"]["turns"], 12)
        self.assertEqual(run["pass_rates"]["before"]["rate"], 0.8)
        self.assertEqual(run["pass_rates"]["after"]["rate"], 0.8)
        self.assertEqual(run["pass_rates"]["recorded_next"]["rate"], 0.75)

    def test_an_output_dir_inside_the_seeds_is_refused(self):
        self.out = self.fx.seeds / "c209-a1a" / "scratch"
        runner = FakeRunner()
        code, _, err = self.run_main(runner=runner)
        self.assertEqual(code, 2)
        self.assertIn("read-only seeds", err)
        self.assertEqual(runner.calls, [])
        self.assertFalse(self.out.exists())

    def test_an_existing_run_dir_is_not_overwritten(self):
        self.out.mkdir(parents=True)
        (self.out / "run.json").write_text("{}")
        code, _, _ = self.run_main()
        self.assertEqual(code, 2)
        self.assertEqual((self.out / "run.json").read_text(), "{}")

    def test_a_missing_next_checkpoint_spec_is_refused(self):
        argv = ["run", PROBLEM, "2", str(self.fx.seed_cp()), "--seed-set", "s", "--out", str(self.out)]
        code, _, err = self.run_argv(argv)
        self.assertEqual(code, 2)
        self.assertIn("checkpoint_3", err)
        self.assertFalse(self.out.exists())


class PlanTests(unittest.TestCase):
    def test_include_prior_tests_follows_the_checkpoint_config(self):
        import yaml

        config = yaml.safe_load(CONFIG)
        self.assertTrue(plan.include_prior_tests(config, 2))
        self.assertFalse(plan.include_prior_tests(config, 3))

    @unittest.skipIf(jinja2 is None, "needs jinja2")
    def test_prompt_is_the_runner_render_of_the_a1a_continuation(self):
        prompt = plan.render_prompt(SPEC, "wc")
        self.assertNotIn("canary", prompt)
        self.assertIn("Run `python wc.py FILE` from wc.py.", prompt)
        self.assertIn("Keep using the same virtual environment", prompt)
        self.assertIn("Keep a `NOTES.md` file", prompt)


class ParityMathTests(unittest.TestCase):
    def test_threshold_is_the_floor_for_a_single_run(self):
        self.assertEqual(parity.spread([0.6]), 0.0)
        self.assertEqual(parity.threshold([0.6]), 0.15)

    def test_threshold_is_twice_the_spread_when_that_is_larger(self):
        self.assertAlmostEqual(parity.spread([0.5, 0.6]), 0.1)
        self.assertAlmostEqual(parity.threshold([0.5, 0.6]), 0.2)
        self.assertEqual(parity.threshold([0.5, 0.55]), 0.15)

    def test_parity_holds_when_every_run_is_within_t(self):
        row = parity.parity_row("p", 2, 0.75, [0.70, 0.80])
        self.assertTrue(row.holds)
        self.assertAlmostEqual(row.max_delta, 0.05)

    def test_parity_holds_at_exactly_t(self):
        self.assertTrue(parity.parity_row("p", 2, 0.75, [0.60]).holds)

    def test_parity_fails_when_one_run_is_beyond_t(self):
        self.assertFalse(parity.parity_row("p", 2, 0.9, [0.72, 0.70]).holds)

    def test_a_wide_spread_widens_t(self):
        self.assertTrue(parity.parity_row("p", 2, 0.9, [0.88, 0.70]).holds)


def run_record(problem="p", arm="original", after=(16, 20), recorded=(15, 20), replicate=1):
    pins = {k: "x" for k in record.PIN_KEYS} | {"harness_dirty": False, "step_limit": 100}
    rates = {"before": record.rate(8, 10), "after": record.rate(*after) if after else None,
             "recorded_next": record.rate(*recorded) if recorded else None}
    return record.build_run(task="C-250", arm=arm, replicate=replicate, problem=problem, n=1, include_prior_tests=True,
                            pins=pins, cost={"usd": 1.0, "turns": 3}, rates=rates, created_at="2026-10-20T00:00:00+00:00")


class ParityTableTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write_runs(self, *runs):
        for i, run in enumerate(runs):
            (self.root / f"r{i}").mkdir()
            (self.root / f"r{i}" / "run.json").write_text(json.dumps(run))

    def test_rows_group_replicates_and_leave_out_other_arms_and_missing_evals(self):
        runs = [run_record(after=(14, 20)), run_record(after=(16, 20), replicate=2),
                run_record(arm="cleaned"), run_record(problem="q", after=None)]
        rows, skipped = parity.parity_rows(runs)
        self.assertEqual(skipped, 2)
        self.assertEqual([(r.problem, r.rates) for r in rows], [("p", (0.7, 0.8))])
        self.assertAlmostEqual(rows[0].threshold, 0.2)
        self.assertTrue(rows[0].holds)

    def test_parity_cli_writes_the_table_and_json(self):
        self.write_runs(run_record(), run_record(problem="q", after=(5, 20)))
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(["parity", str(self.root)], holdout_check=lambda problems: None)
        self.assertEqual(code, 0)
        data = json.loads((self.root / "parity.json").read_text())
        self.assertEqual([(r["problem"], r["holds"]) for r in data["rows"]], [("p", True), ("q", False)])
        self.assertIn("Parity holds on 1 of 2 problem(s)", (self.root / "parity.md").read_text())

    def test_parity_cli_refuses_runs_that_name_a_holdout_problem(self):
        self.write_runs(run_record(problem=HELD))

        def refuse(problems):
            raise holdout.HoldoutRefused("1 of 1 problem(s) are in the sealed holdout")

        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["parity", str(self.root)], holdout_check=refuse), holdout.REFUSED_EXIT)
        self.assertFalse((self.root / "parity.json").exists())

    def test_an_invalid_run_json_is_rejected(self):
        self.write_runs({"schema": record.SCHEMA, "task": "C-250"})
        with self.assertRaises(ValueError):
            parity.load_runs(self.root)


class RunSchemaTests(unittest.TestCase):
    def test_a_complete_run_is_valid(self):
        self.assertEqual(record.validate_run(run_record()), [])

    def test_a_missing_pin_is_an_error(self):
        run = run_record()
        run["pins"]["model_id"] = None
        self.assertIn("missing pin model_id", record.validate_run(run))

    def test_checkpoint_to_must_follow_checkpoint_from(self):
        run = run_record()
        run["checkpoint_to"] = 3
        self.assertIn("checkpoint_to must be checkpoint_from + 1", record.validate_run(run))

    def test_a_rate_outside_unit_range_is_an_error(self):
        run = run_record()
        run["pass_rates"]["after"] = {"passed": 30, "total": 20, "rate": 1.5}
        self.assertIn("pass_rates.after.rate is outside [0, 1]", record.validate_run(run))

    def test_build_run_refuses_an_incomplete_record(self):
        with self.assertRaises(ValueError):
            record.build_run(task="C-250", arm="original", replicate=1, problem="p", n=1, include_prior_tests=True,
                             pins={}, cost={}, rates={}, created_at="t")

    def test_recorded_rate_sums_every_test_group(self):
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            path = Path(tmp) / "evaluation.json"
            path.write_text(json.dumps({"pass_counts": {"Core": 3, "Regression": 4}, "total_counts": {"Core": 4, "Regression": 6}}))
            self.assertEqual(record.recorded_rate(path), {"passed": 7, "total": 10, "rate": 0.7})


if __name__ == "__main__":
    unittest.main()
