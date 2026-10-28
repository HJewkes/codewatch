import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from diffgate import replay
from diffgate.__main__ import main
from runner.container import settle_timeouts

HERE = Path(__file__).parent
FAST = 'import sys\nprint("ok")\nprint("note", file=sys.stderr)\n'
HANG = "import time\ntime.sleep(60)\n"
FIRST_RUN = '''import pathlib, sys, time
marker = pathlib.Path(__file__).with_name("ran")
first = not marker.exists()
marker.touch()
{first}
print("ok")
print("note", file=sys.stderr)
'''
SLOW_FIRST = FIRST_RUN.format(first="if first:\n    time.sleep(60)")
WARN_FIRST = FIRST_RUN.format(first='if first:\n    print("warning: slow disk", file=sys.stderr)')
OTHER_STDERR = 'import sys\nprint("ok")\nprint("a different note", file=sys.stderr)\n'


def write_case(cases: Path, name: str = "c1") -> None:
    (cases / name / "files").mkdir(parents=True)
    case = {"argv": ["{PY}", "{ROOT}/prog.py"], "cwd": "{CASE}", "env": {}, "unset_env": [], "source": "tests"}
    (cases / name / "case.json").write_text(json.dumps(case))


@mock.patch.object(replay, "RETRY_TIMEOUT_S", 1.0)
@mock.patch.object(replay, "TIMEOUT_S", 0.5)
class ReReplay(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.tmp = Path(self._tmp.name)
        write_case(self.tmp / "cases")

    def tearDown(self):
        self._tmp.cleanup()

    def settled(self, base_program: str, head_program: str) -> dict:
        for side, program in (("base", base_program), ("head", head_program)):
            (self.tmp / side).mkdir()
            (self.tmp / side / "prog.py").write_text(program)
        t = self.tmp
        with contextlib.redirect_stdout(io.StringIO()):
            self._gate(t)
        return settle_timeouts(json.loads((t / "gate.json").read_text()))

    @staticmethod
    def _gate(t: Path) -> None:
        main(["replay", "--cases", str(t / "cases"), "--base", str(t / "base"), "--head", str(t / "head"),
              "--python", sys.executable, "--scratch", str(t / "scratch"), "--out", str(t / "runs.json")])
        main(["verdict", "--cases", str(t / "cases"), "--runs", str(t / "runs.json"), "--out", str(t / "gate.json"),
              "--mode", "inloop"])

    def test_a_timeout_that_resolves_on_the_serial_rerun_passes_as_the_same(self):
        # mutation: dropping the re-replay leaves the head's first-run timeout as an inconclusive case
        gate = self.settled(FAST, SLOW_FIRST)
        self.assertEqual((gate["pass"], gate["inconclusive"], gate["tiers"]["tests"]["same"]), (True, [], 1))

    def test_a_head_that_hangs_again_on_the_rerun_is_a_difference(self):
        # mutation: counting every second timeout as inconclusive passes the hang
        gate = self.settled(FAST, HANG)
        self.assertEqual((gate["pass"], gate["inconclusive"]), (False, []))
        self.assertEqual(gate["differences"][0]["head"]["rc"], "timeout")

    def test_a_base_that_hangs_again_on_the_rerun_is_inconclusive(self):
        # mutation: counting a second timeout on the base as a behaviour change of the lane
        gate = self.settled(HANG, FAST)
        self.assertEqual((gate["pass"], gate["inconclusive"]), (True, ["c1"]))

    def test_a_stderr_only_flake_that_resolves_on_the_rerun_is_not_a_difference(self):
        # mutation: re-replaying only timeouts, not stderr-only differences, rejects on the flake
        gate = self.settled(FAST, WARN_FIRST)
        self.assertEqual((gate["pass"], gate["differences"]), (True, []))

    def test_a_stderr_difference_that_repeats_on_the_rerun_still_fails(self):
        # mutation: dropping stderr from the compared fields passes a changed message
        gate = self.settled(FAST, OTHER_STDERR)
        self.assertEqual((gate["pass"], gate["differences"][0]["fields"]), (False, ["stderr"]))


if __name__ == "__main__":
    unittest.main()
