import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.ar_fixtures import BENCH, stub_inputs, stub_pin

SCRIPT = "ar_preflight.sh"


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.pin = stub_pin(root / "pin")
        (self.pin / "autoresearch" / SCRIPT).write_bytes((BENCH / "autoresearch" / SCRIPT).read_bytes())
        self.env = stub_inputs(root, "case-a", "set-a", "prob")
        self.app = Path(self.env["S7_INPUTS"], "frozen", "set-a", "prob_cp1", "app.py")

    def tearDown(self):
        self._tmp.cleanup()

    def preflight(self) -> subprocess.CompletedProcess:
        return subprocess.run(["bash", str(self.pin / "autoresearch" / SCRIPT), "set-a", "prob", "case-a"],
                              env=self.env, capture_output=True, text=True)

    def test_first_call_records_the_hash_and_a_repeat_passes(self):
        self.assertEqual(self.preflight().returncode, 0)
        self.assertEqual(self.preflight().returncode, 0)

    def test_inputs_changed_since_the_record_exit_5(self):
        self.preflight()
        self.app.write_text("x = 2\n")
        result = self.preflight()
        self.assertEqual(result.returncode, 5)
        self.assertIn("differ", result.stderr)

    def test_a_prep_that_is_not_evaluable_exits_6(self):
        prep = Path(self.env["S7_INPUTS"], "prep", "case-a.json")
        prep.write_text(prep.read_text().replace('"n": 1', '"n": 1, "evaluable": false'))
        self.assertEqual(self.preflight().returncode, 6)


if __name__ == "__main__":
    unittest.main()
