"""The fix stage proves its test check at the base, then judges each item against that base."""

import unittest
from dataclasses import replace

from remediation.oracle import failing_ids
from tests.remediation_support import FakeClaude, FakeTools, StageTestCase, confirmed, pytest_output, \
    write_verdicts, writes

OLD = "tests/test_app.py::test_old"
NEW = "tests/test_app.py::test_new"
CUSTOM = ["make", "check"]
BROKEN_MODULE = "tests/test_broken.py"
INTERRUPTED = (2, "\n=========== short test summary info ===========\n"
                  f"ERROR {BROKEN_MODULE} - ImportError: cannot import name 'gone'\n"
                  "!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!\n")


class CustomTools(FakeTools):
    """Runs a custom test command, which prints nothing pytest-shaped, with the given exit codes."""

    def __init__(self, base, tests=()):
        super().__init__()
        self.base_code, self.codes = base, list(tests)
        self.custom_runs = 0

    def __call__(self, argv, env, cwd, timeout):
        if list(argv) != CUSTOM:
            return super().__call__(argv, env, cwd, timeout)
        self.custom_runs += 1
        code = self.base_code if self.custom_runs == 1 else (self.codes.pop(0) if self.codes else 0)
        return code, "", False


class BasePreflightTest(StageTestCase):
    def test_a_clean_base_records_a_passing_oracle_and_keeps_a_green_fix(self):
        write_verdicts(self.root, [confirmed()])
        tools = FakeTools()

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), tools)

        self.assertEqual(report["oracle"], {"class": "pass", "failing": [], "reason": "exit 0"})
        self.assertEqual(report["items"][0]["status"], "kept")
        self.assertEqual(len(tools.test_argvs), 2)

    def test_a_base_that_fails_naming_no_test_is_unavailable_and_starts_nothing(self):
        write_verdicts(self.root, [confirmed()])
        claude = FakeClaude(writes("src/app.py", "x = 3\n"))
        tools = FakeTools(base=(4, "ERROR: file or directory not found: tests\n"))

        report = self.run_stage(claude, tools)

        self.assertEqual((report["outcome"], report["oracle"]["class"]), ("check-unavailable", "unavailable"))
        self.assertIn("cannot be judged at the base (exit 4)", report["reason"])
        self.assertEqual((claude.calls, len(tools.test_argvs)), ([], 1))
        self.assertNotIn("items", report)

    def test_a_base_run_interrupted_by_a_collection_error_is_unavailable_and_starts_nothing(self):
        write_verdicts(self.root, [confirmed()])
        claude = FakeClaude(writes("src/app.py", "x = 3\n"))

        report = self.run_stage(claude, FakeTools(base=INTERRUPTED))

        self.assertEqual(report["oracle"], {"class": "unavailable", "failing": [],
                                            "reason": report["reason"]})
        self.assertIn("(exit 2)", report["reason"])
        self.assertEqual((report["outcome"], claude.calls), ("check-unavailable", []))

    def test_a_pytest_command_that_stops_at_the_first_failure_is_unavailable_and_runs_nothing(self):
        write_verdicts(self.root, [confirmed()])
        claude, tools = FakeClaude(writes("src/app.py", "x = 3\n")), FakeTools()
        config = replace(self.config, test_command=["python", "-m", "pytest", "-x", "-q", "tests"])

        report = self.run_stage(claude, tools, config=config)

        self.assertEqual((report["outcome"], report["oracle"]["class"]), ("check-unavailable", "unavailable"))
        self.assertIn("-x", report["reason"])
        self.assertEqual((claude.calls, tools.test_argvs), ([], []))

    def test_a_custom_command_that_fails_at_base_is_unavailable(self):
        write_verdicts(self.root, [confirmed()])
        claude = FakeClaude(writes("src/app.py", "x = 3\n"))

        report = self.run_stage(claude, CustomTools(base=2), config=replace(self.config, test_command=CUSTOM))

        self.assertEqual((report["outcome"], report["oracle"]["class"]), ("check-unavailable", "unavailable"))
        self.assertEqual(claude.calls, [])

    def test_a_custom_command_is_judged_by_its_exit_code(self):
        write_verdicts(self.root, [confirmed(), confirmed("clone")])
        claude = FakeClaude(writes("src/app.py", "x = 3\n"), writes("src/app.py", "x = 4\n"))
        tools = CustomTools(base=0, tests=[1, 0])

        report = self.run_stage(claude, tools, config=replace(self.config, test_command=CUSTOM))

        self.assertEqual([i["status"] for i in report["items"]], ["reverted", "kept"])
        self.assertEqual(report["items"][0]["reason"], "tests: exit 1")
        self.assertEqual(tools.custom_runs, 3)


class BaselineJudgingTest(StageTestCase):
    def test_a_fix_on_a_base_failing_suite_that_adds_no_failure_is_kept(self):
        write_verdicts(self.root, [confirmed()])
        tools = FakeTools(base=(1, pytest_output(OLD)), tests=[(1, pytest_output(OLD))])

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), tools)

        self.assertEqual(report["oracle"], {"class": "base-failing", "failing": [OLD], "reason": "exit 1"})
        self.assertEqual(report["items"][0]["status"], "kept")
        self.assertEqual(len(tools.test_argvs), 2)

    def test_a_fix_that_adds_a_failure_that_reproduces_is_reverted(self):
        write_verdicts(self.root, [confirmed()])
        tools = FakeTools(base=(1, pytest_output(OLD)), tests=[(1, pytest_output(OLD, NEW)), (1, pytest_output(NEW))])

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), tools)

        item = report["items"][0]
        self.assertEqual((item["status"], item["reason"]), ("reverted", f"tests: new failures: {NEW}"))
        self.assertEqual((self.root / "src" / "app.py").read_text(), "x = 2\n")

    def test_an_item_run_interrupted_by_a_collection_error_is_reverted_without_a_rerun(self):
        write_verdicts(self.root, [confirmed()])
        tools = FakeTools(base=(1, pytest_output(OLD)), tests=[INTERRUPTED, 0])

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), tools)

        item = report["items"][0]
        self.assertEqual((item["status"], item["reason"]), ("reverted", "tests: exit 2"))
        self.assertEqual(len(tools.test_argvs), 2)

    def test_a_new_failure_that_passes_on_rerun_is_kept_and_marked_flaky(self):
        write_verdicts(self.root, [confirmed()])
        tools = FakeTools(tests=[(1, pytest_output(NEW)), 0])

        report = self.run_stage(FakeClaude(writes("src/app.py", "x = 3\n")), tools)

        item = report["items"][0]
        self.assertEqual((item["status"], item["flaky"]), ("kept", [NEW]))
        self.assertEqual(tools.test_argvs[-1], ["python", "-m", "pytest", "-q", "-rfE", NEW])


class SummaryTest(unittest.TestCase):
    def test_a_parametrized_id_with_a_dash_is_read_whole(self):
        stdout = ("=========== short test summary info ===========\n"
                  "FAILED tests/t.py::test[a - b] - AssertionError: assert [1] == [2]\n"
                  "FAILED tests/t.py::test[c] - assert [1] == [2]\n"
                  f"ERROR {BROKEN_MODULE}\n")

        self.assertEqual(failing_ids(stdout), {"tests/t.py::test[a - b]", "tests/t.py::test[c]", BROKEN_MODULE})


class SameReasonStopTest(StageTestCase):
    def test_three_reverts_in_a_row_for_the_same_reason_stop_the_stage(self):
        write_verdicts(self.root, [confirmed(s) for s in ("symbol-cognitive", "clone", "ERA001", "symbol-pass-through")])
        claude = FakeClaude(*(writes("src/app.py", f"x = {n}\n") for n in range(3, 7)))

        report = self.run_stage(claude, FakeTools(tests=[1, 1, 1, 1]))

        self.assertEqual([i["status"] for i in report["items"]], ["reverted"] * 3 + ["not-started"])
        self.assertEqual((report["outcome"], report["stopped_by"]), ("stage-stopped", "stage-stopped: tests: exit 1"))
        self.assertEqual(len(claude.calls), 3)

    def test_reverts_for_different_reasons_do_not_stop_the_stage(self):
        write_verdicts(self.root, [confirmed(s) for s in ("symbol-cognitive", "clone", "ERA001", "symbol-pass-through")])
        claude = FakeClaude(*(writes("src/app.py", f"x = {n}\n") for n in range(3, 7)))

        report = self.run_stage(claude, FakeTools(tests=[1, 2, 1, 0]))

        self.assertEqual([i["status"] for i in report["items"]], ["reverted"] * 3 + ["kept"])
        self.assertIsNone(report["stopped_by"])


if __name__ == "__main__":
    unittest.main()
