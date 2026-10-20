import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from regrade import holdout
from regrade.yardstick import collect, main, parser, run
from regrade.yardstick_metrics import METRICS, ScoreFailed, score
from regrade.yardstick_seeds import compare, freeze


def metrics(value=1):
    return dict.fromkeys(METRICS, value)


def write(root, name, text="def f():\n    return 1\n"):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


class YardstickTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_official_and_ex_tests_use_the_same_snapshot_policy(self):
        tree = self.root / "tree"
        write(tree, "app.py")
        write(tree, "tests/test_app.py")
        write(tree, ".venv/ignored.py")
        seen = []

        def check(path):
            count = len(list(path.rglob("*.py")))
            seen.append(count)
            return {"erosion": count / 10, "verbosity": .2, "total_loc": count}

        def cc(path):
            count = len(list(path.rglob("*.py")))
            return {"cc_total": count * 3, "source_lines": count}

        result = score(tree, self.root, check, cc)
        self.assertEqual(seen, [2, 1])
        self.assertEqual((result["erosion"], result["erosion_ex_tests"]), (.2, .1))
        self.assertEqual((result["cc_total"], result["cc_total_ex_tests"]), (6, 3))
        self.assertTrue((tree / ".venv/ignored.py").is_file())

    def test_missing_metrics_are_failures_instead_of_zero_scores(self):
        tree = self.root / "tree"
        write(tree, "app.py")
        with self.assertRaises(ScoreFailed):
            score(tree, self.root, lambda _: {}, lambda _: {})

    def test_mismatched_scorer_and_cc_populations_are_refused(self):
        tree = self.root / "tree"
        write(tree, "app.py")
        with self.assertRaisesRegex(ScoreFailed, "populations differ"):
            score(tree, self.root, lambda _: {"erosion": .2, "verbosity": .1, "total_loc": 3},
                  lambda _: {"cc_total": 2, "source_lines": 4})

    def test_sealed_items_refuse_before_any_scoring_or_seed_reads(self):
        calls = []
        with self.assertRaises(holdout.HoldoutRefused) as refused:
            collect([("sealed_fixture", 1, self.root)], {"sealed_fixture"}, self.root,
                    self.root, scorer=lambda *args: calls.append(args))
        self.assertEqual(calls, [])
        self.assertNotIn("sealed_fixture", str(refused.exception))

    def test_matching_uses_problem_and_checkpoint_and_omits_missing_seeds(self):
        seeds = self.root / "seeds"
        write(seeds, "dev_fixture/checkpoint_2/snapshot/app.py")
        items = [("dev_fixture", 1, self.root), ("dev_fixture", 2, self.root)]
        result = collect(items, set(), seeds, self.root, scorer=lambda *_: metrics(.5))
        self.assertIsNone(result["rows"][0]["seed"])
        self.assertEqual(result["aggregates"]["reference_dev"]["checkpoints"], 2)
        self.assertEqual(result["aggregates"]["matched_reference"]["checkpoints"], 1)
        self.assertEqual(result["aggregates"]["a1a_seed"]["checkpoints"], 1)

    def test_dev_run_refuses_sealed_rows_and_emits_only_counts(self):
        catalog = self.root / "catalog"
        for name in ("dev_fixture", "sealed_fixture"):
            write(catalog, f"{name}/solutions/checkpoint_1/app.py")
        args = parser().parse_args(["--catalog", str(catalog), "--seeds", str(self.root / "seeds"),
                                   "--suite-seeds", str(self.root / "suite"),
                                   "--scratch", str(self.root / "scratch"),
                                   "--out", str(self.root / "result.json"),
                                   "--report", str(self.root / "report.md")])
        with patch.object(holdout, "holdout_problems", return_value={"sealed_fixture"}), \
                patch.object(holdout, "check", side_effect=holdout.HoldoutRefused("sealed")) as guard:
            result = run(args, scorer=lambda *_: metrics(.25))
        guard.assert_called_once_with(["sealed_fixture"])
        self.assertEqual((result["requested_checkpoints"], result["refused_checkpoints"]), (1, 1))
        for file in (args.out, args.report):
            self.assertNotIn("sealed_fixture", file.read_text())
        self.assertEqual(json.loads(args.out.read_text())["rows"][0]["problem"], "dev_fixture")

    def test_unreadable_manifest_exits_three_without_outputs_or_traceback(self):
        argv = ["--out", str(self.root / "out.json"), "--report", str(self.root / "out.md")]
        with patch.object(holdout, "holdout_problems", side_effect=holdout.HoldoutRefused("sealed_fixture")):
            with contextlib.redirect_stderr(io.StringIO()) as stderr:
                code = main(argv)
        self.assertEqual(code, 3)
        self.assertNotIn("sealed_fixture", stderr.getvalue())
        self.assertFalse((self.root / "out.json").exists())

    def test_failed_reference_score_stays_a_gap_and_does_not_score_seed(self):
        calls = []

        def fail(*args):
            calls.append(args)
            raise ScoreFailed("details withheld")

        result = collect([("dev_fixture", 1, self.root)], set(), self.root, self.root, scorer=fail)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["failures"], 1)
        self.assertEqual(result["aggregates"]["reference_dev"]["checkpoints"], 0)

    def test_failed_seed_score_keeps_the_successful_reference_score(self):
        seeds = self.root / "seeds"
        write(seeds, "dev_fixture/checkpoint_1/snapshot/app.py")

        def check(path, _):
            if path == self.root:
                return metrics(.2)
            raise ScoreFailed("seed failed")

        result = collect([("dev_fixture", 1, self.root)], set(), seeds, self.root, scorer=check)
        self.assertEqual(result["failures"], 1)
        self.assertEqual(result["aggregates"]["reference_dev"]["checkpoints"], 1)
        self.assertEqual(result["rows"][0]["seed_status"], "scoring_failed")

    def test_frozen_arm_ignores_later_arrivals_and_sealed_problems(self):
        arm = self.root / "suite"
        write(arm, "dev_fixture/checkpoint_1/snapshot/app.py")
        write(arm, "sealed_fixture/checkpoint_1/snapshot/app.py")
        inventory = freeze(arm, {"sealed_fixture"})
        write(arm, "dev_fixture/checkpoint_2/snapshot/app.py")
        result = {"rows": [{"problem": "dev_fixture", "checkpoint": n,
                            "status": "ok", "reference": metrics(.5)} for n in (1, 2)]}
        comparison = compare(result, inventory, self.root, scorer=lambda *_: metrics(.75))
        self.assertEqual(comparison["frozen_checkpoints"], 1)
        self.assertEqual(comparison["matched_checkpoints"], 1)
        self.assertEqual(comparison["frozen_problems"], ["dev_fixture"])
        self.assertEqual(comparison["seed_mean"]["erosion"], .75)
        self.assertNotIn("sealed_fixture", json.dumps(comparison))

    def test_overlapping_arms_are_compared_separately(self):
        result = {"rows": [{"problem": "dev_fixture", "checkpoint": 1,
                            "status": "ok", "reference": metrics(.25)}]}
        arms = []
        for label in ("first", "second"):
            path = self.root / label
            write(path, "dev_fixture/checkpoint_1/snapshot/app.py")
            arms.append(freeze(path, set()))
        first = compare(result, arms[0], self.root, scorer=lambda *_: metrics(.5))
        second = compare(result, arms[1], self.root, scorer=lambda *_: metrics(.75))
        self.assertEqual((first["matched_checkpoints"], second["matched_checkpoints"]), (1, 1))
        self.assertEqual((first["seed_mean"]["erosion"], second["seed_mean"]["erosion"]), (.5, .75))


if __name__ == "__main__":
    unittest.main()
