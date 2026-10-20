import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent / "c239" / "harness" / "evalprep.py"
HAVE_YAML = importlib.util.find_spec("yaml") is not None
if HAVE_YAML:
    spec = importlib.util.spec_from_file_location("evalprep", HARNESS)
    evalprep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evalprep)

CONFIG = """
entry_file: tool
test_dependencies: [httpx]
static_assets:
  data_dir:
    path: data
checkpoints:
  checkpoint_1: {order: 1}
  checkpoint_2: {order: 2}
  checkpoint_3: {order: 3, include_prior_tests: false, env: {MODE: strict}}
"""


def make_problem(root: Path) -> Path:
    problem = root / "problem"
    (problem / "tests" / "fixtures").mkdir(parents=True)
    (problem / "data").mkdir()
    (problem / "data" / "table.csv").write_text("a\n")
    (problem / "config.yaml").write_text(CONFIG)
    for name in ("conftest.py", "helpers.py", "test_checkpoint_1.py", "test_checkpoint_2.py", "test_checkpoint_3.py"):
        (problem / "tests" / name).write_text("")
    (problem / "tests" / "fixtures" / "case.json").write_text("{}")
    return problem


def run(problem: Path, n: int, ws: Path) -> str:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        evalprep.main(str(problem), str(n), str(ws))
    return out.getvalue()


@unittest.skipUnless(HAVE_YAML, "evalprep reads the problem config with PyYAML")
class EvalPrepTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.problem = make_problem(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_prior_checkpoint_tests_are_included_by_default(self):
        ws = self.root / "ws"
        run(self.problem, 2, ws)
        names = {p.name for p in (ws / ".evaluation_tests").glob("test_*.py")}
        self.assertEqual(names, {"test_checkpoint_1.py", "test_checkpoint_2.py"})

    def test_checkpoint_without_prior_tests_runs_only_its_own(self):
        ws = self.root / "ws"
        run(self.problem, 3, ws)
        names = {p.name for p in (ws / ".evaluation_tests").glob("test_*.py")}
        self.assertEqual(names, {"test_checkpoint_3.py"})

    def test_support_files_assets_and_settings_are_laid_out(self):
        ws = self.root / "ws"
        settings = run(self.problem, 3, ws)
        tests = ws / ".evaluation_tests"
        self.assertTrue((tests / "conftest.py").is_file() and (tests / "helpers.py").is_file())
        self.assertTrue((tests / "fixtures" / "case.json").is_file())
        self.assertTrue((tests / "assets" / "data_dir" / "table.csv").is_file())
        self.assertIn("SCBENCH_ASSET_DATA_DIR=.evaluation_tests/assets/data_dir", settings)
        self.assertIn("MODE=strict", settings)
        self.assertIn("--with=httpx", settings)
        self.assertIn("markers =", (ws / "pytest.ini").read_text())


if __name__ == "__main__":
    unittest.main()
