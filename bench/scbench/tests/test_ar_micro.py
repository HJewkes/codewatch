import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.ar_fixtures import BENCH, replay_run

MICRO = BENCH / "autoresearch" / "micro.py"
_spec = importlib.util.spec_from_file_location("ar_micro", MICRO)
micro_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(micro_module)


def micro(*args: str) -> dict:
    out = subprocess.run([sys.executable, "-I", str(MICRO), *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.run = replay_run(root / "run", root / "scratch")

    def tearDown(self):
        self._tmp.cleanup()

    def test_replay_with_the_pinned_gate_reproduces_the_recorded_counts(self):
        got = micro("replay", str(BENCH), str(self.run))
        self.assertEqual((got["lanes"], got["accepts"], got["rejects"], got["holds"], got["changed"]), (3, 1, 2, 0, 0))
        self.assertEqual((got["accepted_net_cc"], got["accepted_new_helpers"]), (-3, 1))

    def test_a_lane_sees_only_ledger_rows_written_before_its_runner_wave(self):
        earlier = {(lane["wave"], lane["task"]): lane["earlier_rows"] for lane in micro_module.lanes(self.run)}
        self.assertEqual(earlier, {(1, "app.py:handle"): 0, (1, "other.py:handle_b"): 0, (2, "app.py:handle"): 1})

    def test_recorded_counts_can_be_read_for_one_task(self):
        got = micro("recorded", str(BENCH), str(self.run), "app.py:handle")
        self.assertEqual((got["lanes"], got["accepts"], got["rejects"]), (2, 1, 1))


class CompareTests(unittest.TestCase):
    BASE = {"accepts": 3, "rejects": 1, "holds": 0, "accepted_net_cc": 4, "accepted_new_helpers": 5}

    def test_predicted_drop_is_met_only_when_the_count_falls(self):
        fell = micro("compare", json.dumps(self.BASE), json.dumps({**self.BASE, "accepted_net_cc": 1}), "accepted_net_cc:down", "L1-replay")
        flat = micro("compare", json.dumps(self.BASE), json.dumps(self.BASE), "accepted_net_cc:down", "L1-replay")
        self.assertEqual((fell["schema"], fell["rung"], fell["predicted_direction_met"]), ("ar-micro/v1", "L1-replay", True))
        self.assertFalse(flat["predicted_direction_met"])

    def test_unknown_signal_count_is_refused(self):
        done = subprocess.run([sys.executable, "-I", str(MICRO), "compare", json.dumps(self.BASE), json.dumps(self.BASE),
                               "speed:up", "L1-replay"], capture_output=True, text=True, check=False)
        self.assertNotEqual(done.returncode, 0)


if __name__ == "__main__":
    unittest.main()
