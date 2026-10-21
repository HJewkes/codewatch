import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.ar_fixtures import BENCH

PROOF = BENCH / "autoresearch" / "ar_testproof.sh"
BUGGY, FIXED = "def double(x):\n    return x + 1\n", "def double(x):\n    return x + x\n"
CATCHES_BUG = "import unittest\nfrom lib import double\n\n\nclass T(unittest.TestCase):\n    def test_three(self):\n        self.assertEqual(double(3), 6)\n"
PASSES_ANYWAY = CATCHES_BUG.replace("double(3), 6", "double(1), 2")


class TestProofTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q")
        self.commit({"lib.py": BUGGY, "tests/__init__.py": ""})
        self.base = self.git("rev-parse", "HEAD")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args: str) -> str:
        return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args], cwd=self.repo,
                              capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, files: dict[str, str]) -> str:
        for rel, text in files.items():
            path = self.repo / "bench" / "scbench" / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.git("add", "-A")
        self.git("commit", "-qm", "c")
        return self.git("rev-parse", "HEAD")

    def proof(self, head: str) -> tuple[int, dict]:
        done = subprocess.run(["bash", str(PROOF), self.base, head], cwd=self.repo, capture_output=True, text=True, check=False)
        return done.returncode, json.loads(done.stdout)

    def test_test_that_fails_on_base_and_passes_on_the_fix_proves_the_idea(self):
        rc, out = self.proof(self.commit({"lib.py": FIXED, "tests/test_double.py": CATCHES_BUG}))
        self.assertEqual((rc, out["pass"], out["tests"]), (0, True, ["bench/scbench/tests/test_double.py"]))
        self.assertNotEqual(out["base_rc"], 0)

    def test_test_that_already_passes_on_base_proves_nothing(self):
        rc, out = self.proof(self.commit({"lib.py": FIXED, "tests/test_double.py": PASSES_ANYWAY}))
        self.assertEqual((rc, out["pass"], out["base_rc"], out["head_rc"]), (1, False, 0, 0))

    def test_idea_without_a_test_is_refused(self):
        rc, out = self.proof(self.commit({"lib.py": FIXED}))
        self.assertEqual((rc, out["pass"]), (2, False))


if __name__ == "__main__":
    unittest.main()
