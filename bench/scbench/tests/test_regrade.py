import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from regrade.__main__ import main

HERE = Path(__file__).parent


def counting_scb_check(path):
    """Erosion is the share of scanned .py files outside tests/; verbosity is 1 / file count."""
    files = sorted(p.relative_to(path).as_posix() for p in path.rglob("*.py"))
    source = [f for f in files if not f.startswith("tests/")]
    return {"erosion": len(source) / len(files), "verbosity": 1 / len(files), "files_scanned": len(files)}


def fake_hidden_eval(tree, scratch):
    return {"passed": len(list(tree.glob("*.py"))), "total": 3, "failed": []}


def write_tree(root, files):
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)
    return root


class RegradeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self._tmp.name)
        seed = self.root / "seed" / "checkpoint_3"
        write_tree(seed / "snapshot", {"app.py": "x", "tests/test_a.py": "t"})
        (seed / "evaluation.json").write_text(json.dumps(
            {"pass_counts": {"Core": 1}, "total_counts": {"Core": 1, "Error": 2}}))
        self.seed = seed
        self.recorded = self.root / "checkpoint_results.jsonl"
        self.recorded.write_text(json.dumps(
            {"problem": "p", "checkpoint": "checkpoint_3", "erosion": 0.5, "verbosity": 0.5}) + "\n")

    def tearDown(self):
        self._tmp.cleanup()

    def run_regrade(self, head):
        out = self.root / "out.json"
        argv = ["--problem", "p", "--checkpoint", "3", "--base", str(self.seed), "--head", str(head),
                "--out", str(out), "--recorded", str(self.recorded), "--scratch", str(self.root / "s")]
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            main(argv, scb_check=counting_scb_check, hidden_eval=fake_hidden_eval)
        return json.loads(out.read_text()), stdout.getvalue()

    def test_no_op_copy_reproduces_the_recorded_scores_and_has_zero_delta(self):
        head = write_tree(self.root / "head", {"app.py": "x", "tests/test_a.py": "t"})

        result, row = self.run_regrade(head)

        self.assertEqual(result["parity"], {"gaps": {"erosion": 0.0, "verbosity": 0.0},
                                            "scores_ok": True, "hidden_ok": True})
        self.assertEqual(result["delta"], {"erosion": 0.0, "verbosity": 0.0,
                                           "erosion_ex_tests": 0.0, "verbosity_ex_tests": 0.0})
        self.assertIn("| head | 1/3 → 1/3 | 0.500 → 0.500 |", row)

    def test_tool_output_dirs_are_not_graded_and_tests_excluded_form_drops_tests(self):
        head = write_tree(self.root / "head", {
            "app.py": "x", "tests/test_a.py": "t", "tests/test_b.py": "t",
            ".venv/lib/site.py": "v", ".git/hooks/h.py": "g", "__pycache__/c.py": "c",
        })

        after = self.run_regrade(head)[0]["after"]

        self.assertAlmostEqual(after["erosion"], 1 / 3)
        self.assertEqual(after["files_scanned"], 3)
        self.assertEqual((after["erosion_ex_tests"], after["verbosity_ex_tests"]), (1.0, 1.0))

    def test_a_read_only_seed_is_evaluated_on_a_writable_copy(self):
        for path in (*self.seed.rglob("*"), self.seed):
            path.chmod(0o555 if path.is_dir() else 0o444)
        head = write_tree(self.root / "head", {"app.py": "x"})

        def writing_eval(tree, scratch):
            (tree / ".evaluation_tests").mkdir()
            return fake_hidden_eval(tree, scratch)

        out = self.root / "out.json"
        argv = ["--problem", "p", "--checkpoint", "3", "--base", str(self.seed), "--head", str(head),
                "--out", str(out), "--scratch", str(self.root / "s")]
        with contextlib.redirect_stdout(io.StringIO()):
            main(argv, scb_check=counting_scb_check, hidden_eval=writing_eval)

        self.assertEqual(json.loads(out.read_text())["before"]["hidden"]["passed"], 1)

    def test_a_score_that_differs_from_the_recorded_one_fails_parity(self):
        self.recorded.write_text(json.dumps(
            {"problem": "p", "checkpoint": "checkpoint_3", "erosion": 0.6, "verbosity": 0.5}) + "\n")
        head = write_tree(self.root / "head", {"app.py": "x"})

        parity = self.run_regrade(head)[0]["parity"]

        self.assertFalse(parity["scores_ok"])
        self.assertAlmostEqual(parity["gaps"]["erosion"], 0.1)


if __name__ == "__main__":
    unittest.main()
