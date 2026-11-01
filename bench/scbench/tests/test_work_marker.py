"""C-282: the runner prints `ar-work-started` once, after its load wait, before the first billed session;
ar_eval.sh forwards it to its own stderr while the S7 log keeps the rest."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from runner import __main__ as runner_main
from tests.test_ar_eval import StubPinTestCase

MARKER = "ar-work-started\n"


def steps(max_load: float | None = 10.0) -> runner_main.ContainerSteps:
    with mock.patch.object(runner_main.container, "gate_lib", return_value=Path("lib")):
        return runner_main.ContainerSteps("prob", 1, Path("out"), 5, max_load)


class RunnerMarkerTests(unittest.TestCase):
    def setUp(self):
        self.events: list[str] = []
        self.dir = tempfile.TemporaryDirectory()
        self.marker = Path(self.dir.name) / "marker"
        self.fd = os.open(self.marker, os.O_WRONLY | os.O_CREAT)
        self.addCleanup(self.dir.cleanup)

    def run_sessions(self, loads: list[float], count: int = 2) -> str:
        s = steps()
        def session(*args):
            self.events.append("session")
            return {}
        with mock.patch.dict(os.environ, {runner_main.WORK_FD_ENV: str(self.fd)}), \
             mock.patch.object(runner_main.os, "getloadavg", side_effect=[(0, v, 0) for v in loads]), \
             mock.patch.object(runner_main.time, "sleep", side_effect=lambda _: self.events.append("sleep")), \
             mock.patch.object(runner_main.container, "session", side_effect=session):
            for _ in range(count):
                s.session("t", Path("ws"), "x", Path("g"), Path("b"), Path("o"))
        os.close(self.fd)
        return self.marker.read_text()

    def test_marker_is_written_once_after_the_gate_releases_and_before_the_first_session(self):
        written = self.run_sessions([30, 20, 5, 5])
        self.assertEqual(written, MARKER)
        self.assertEqual(self.events, ["sleep", "sleep", "session", "session"])

    def test_marker_is_not_written_while_the_gate_still_holds(self):
        s = steps()
        with mock.patch.dict(os.environ, {runner_main.WORK_FD_ENV: str(self.fd)}), \
             mock.patch.object(runner_main.os, "getloadavg", return_value=(0, 30, 0)), \
             mock.patch.object(runner_main.time, "sleep", side_effect=StopIteration):
            with self.assertRaises(StopIteration):
                s.session("t", Path("ws"), "x", Path("g"), Path("b"), Path("o"))
        self.assertEqual(self.marker.read_text(), "")

    def test_without_the_fd_the_session_runs_and_nothing_is_written(self):
        s = steps(None)
        env = {k: v for k, v in os.environ.items() if k != runner_main.WORK_FD_ENV}
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(runner_main.container, "session", return_value={}):
            self.assertEqual(s.session("t", Path("ws"), "x", Path("g"), Path("b"), Path("o")), {})


class ShellForwardingTests(StubPinTestCase):
    def setUp(self):
        super().setUp()
        for root in (self.pin, self.idea):
            main = root / "runner" / "__main__.py"
            main.write_text(main.read_text() + (
                "os.write(int(os.environ['AR_WORK_FD']), b'ar-work-started\\n')\n"
                "print('runner chatter', file=sys.stderr)\n"))

    def test_ar_eval_stderr_carries_the_marker_once_and_runner_err_keeps_the_rest(self):
        done = subprocess.run(["bash", str(self.pin / "autoresearch" / "ar_eval.sh"), "set-a", "case-a", "case-a-r1", "0.5",
                               str(self.idea)], env=self.env, capture_output=True, text=True, check=False)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stderr.count(MARKER), 1)
        self.assertNotIn("runner chatter", done.stderr)
        run = Path(self.env["HOME"]) / ".cache" / "c248-s7" / "runs" / "case-a-r1"
        self.assertIn("runner chatter", (run / "runner.err").read_text())
        self.assertNotIn("ar-work-started", (run / "runner.err").read_text())


if __name__ == "__main__":
    unittest.main()
