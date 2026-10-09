import os
import unittest
from pathlib import Path
from unittest import mock

from agent import output_guard
from agent.output_guard import RunDirInRepo, refuse_repo_run_dir

CHECKOUT_DIR = Path(__file__).resolve().parents[1]
OUTSIDE = "/nonexistent-scbench-runs/A0/run"


class RefuseRepoRunDirTest(unittest.TestCase):
    def test_the_runners_default_relative_outputs_dir_inside_a_checkout_is_refused(self):
        with mock.patch.object(os, "getcwd", return_value=str(CHECKOUT_DIR)), \
                self.assertRaises(RunDirInRepo):
            refuse_repo_run_dir("outputs/sonnet-5.5/run")

    def test_a_dir_outside_any_checkout_is_allowed(self):
        with mock.patch.object(os, "getcwd", return_value=str(CHECKOUT_DIR)):
            refuse_repo_run_dir(OUTSIDE)

    def test_refusal_is_a_nonzero_exit_naming_the_fix(self):
        with self.assertRaises(RunDirInRepo) as caught:
            refuse_repo_run_dir(str(CHECKOUT_DIR / "outputs"))

        self.assertIn("save_dir=", str(caught.exception.code))


try:
    import slop_code  # noqa: F401
    HAS_RUNNER = True
except ModuleNotFoundError:
    HAS_RUNNER = False


@unittest.skipUnless(HAS_RUNNER, "slop-code-bench is not installed; run pnpm test:bench:agent")
class InstallTest(unittest.TestCase):
    def test_the_runner_stops_before_creating_a_run_dir_in_a_checkout(self):
        from slop_code.entrypoints.commands import run_agent

        stock = mock.Mock(return_value=(Path(OUTSIDE), False))
        with mock.patch.object(run_agent, "_resolve_output_directory", stock):
            output_guard.install()
            output_guard.install()
            with self.assertRaises(RunDirInRepo):
                run_agent._resolve_output_directory(str(CHECKOUT_DIR / "outputs"), debug=False)
            stock.assert_not_called()

            result = run_agent._resolve_output_directory(OUTSIDE, debug=False)

        stock.assert_called_once_with(OUTSIDE, debug=False)
        self.assertEqual(result, (Path(OUTSIDE), False))


if __name__ == "__main__":
    unittest.main()
