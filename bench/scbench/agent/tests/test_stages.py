import json
import tempfile
import unittest
from pathlib import Path

from agent.stages import (
    AFTER_SOLVE,
    STAGE_NAMES,
    ExecResult,
    StageBudget,
    StageRunner,
    StageSetting,
    stages_for,
    write_stages_json,
)

MINUTE = 60.0


class FakeClock:
    def __init__(self, start: float = 1_000_000.0, step: float = 0.0) -> None:
        self.now = start
        self.step = step

    def __call__(self) -> float:
        value = self.now
        self.now += self.step
        return value


class RecordingExecutor:
    def __init__(self, results: dict[str, ExecResult | Exception]) -> None:
        self.results = results
        self.calls: list[tuple[str, dict, float]] = []

    def __call__(self, command, env, timeout):
        self.calls.append((command, dict(env), timeout))
        result = self.results.get(command, ExecResult(0, "", False))
        if isinstance(result, Exception):
            raise result
        return result


def make_runner(settings, executor, clock=None, budget=None, logs=None):
    clock = clock or FakeClock()
    budget = budget or StageBudget(checkpoint_start=clock.now)
    log = (lambda event, **kw: logs.append((event, kw))) if logs is not None else (lambda *a, **k: None)
    return StageRunner(settings, budget, executor, clock, log)


class StagePlanTest(unittest.TestCase):
    def test_repo_init_runs_on_the_first_checkpoint_and_inject_from_the_second(self):
        self.assertEqual(stages_for(1, before_solve=True), ("repo-init", "pr-open"))
        self.assertEqual(stages_for(2, before_solve=True), ("pr-open", "inject"))

    def test_after_solve_stages_run_in_design_order_every_checkpoint(self):
        expected = ("commit-ratchet", "audit", "triage", "solve-review", "fix", "synthesis")
        self.assertEqual(stages_for(1, before_solve=False), expected)
        self.assertEqual(stages_for(4, before_solve=False), expected)

    def test_the_replay_stage_is_gone(self):
        self.assertNotIn("replay", STAGE_NAMES)


class StageRunnerTest(unittest.TestCase):
    def test_disabled_and_commandless_stages_are_recorded_without_running(self):
        executor = RecordingExecutor({})
        runner = make_runner({"audit": StageSetting(enabled=True)}, executor)

        runner.run(AFTER_SOLVE, {})

        statuses = {r.stage: r.status for r in runner.records}
        self.assertEqual(statuses["audit"], "missing")
        self.assertEqual(statuses["commit-ratchet"], "disabled")
        self.assertEqual(executor.calls, [])
        self.assertTrue(all(r.exit is None for r in runner.records))

    def test_stage_report_line_fills_metrics_and_passthrough_fields(self):
        report = {"tokens": 900, "usd": 0.31, "items_in": 5, "items_out": 4,
                  "outcome": "kept", "fixed_replay_diffs": 1,
                  "added_symbols": [{"path": "src/a.py", "name": "_h", "flags": ["x"]}]}
        stdout = "progress\n" + json.dumps(report) + "\n"
        executor = RecordingExecutor({"cw-fix": ExecResult(0, stdout, False)})
        clock = FakeClock(step=30)
        deadline = f"{clock.now + 2 * 60 * MINUTE - 3 * MINUTE:.0f}"
        runner = make_runner({"fix": StageSetting(True, "cw-fix")}, executor, clock)

        runner.run(("fix",), {"CW_CHECKPOINT": "3"})

        row = runner.records[0].to_json()
        self.assertEqual(row["status"], "ok")
        self.assertEqual(row["exit"], 0)
        self.assertEqual((row["tokens"], row["usd"], row["items_in"], row["items_out"]), (900, 0.31, 5, 4))
        self.assertEqual(row["outcome"], "kept")
        self.assertEqual(row["added_symbols"][0]["flags"], ["x"])
        self.assertLess(row["start"], row["end"])
        self.assertEqual(executor.calls[0][1],
                         {"CW_CHECKPOINT": "3", "CW_STAGE": "fix", "CW_STAGE_DEADLINE": deadline})

    def test_a_failing_stage_is_logged_and_later_stages_still_run(self):
        executor = RecordingExecutor({"boom": RuntimeError("docker gone"), "bad": ExecResult(2, "", False)})
        settings = {"commit-ratchet": StageSetting(True, "boom"), "audit": StageSetting(True, "bad"),
                    "triage": StageSetting(True, "ok")}
        logs = []
        runner = make_runner(settings, executor, logs=logs)

        runner.run(("commit-ratchet", "audit", "triage"), {})

        rows = [r.to_json() for r in runner.records]
        self.assertEqual([r["status"] for r in rows], ["failed", "failed", "ok"])
        self.assertIn("docker gone", rows[0]["error"])
        self.assertEqual(rows[1]["exit"], 2)
        self.assertEqual([kw["stage"] for _, kw in logs], ["commit-ratchet", "audit"])

    def test_a_timed_out_stage_is_recorded_as_timeout(self):
        executor = RecordingExecutor({"slow": ExecResult(None, "", True)})
        runner = make_runner({"triage": StageSetting(True, "slow")}, executor)

        runner.run(("triage",), {})

        self.assertEqual(runner.records[0].status, "timeout")


class StageBudgetTest(unittest.TestCase):
    def test_with_no_stage_budget_stages_launch_until_the_reserve_before_the_cap(self):
        executor = RecordingExecutor({})
        clock = FakeClock(step=10 * MINUTE)
        settings = {name: StageSetting(True, name) for name in AFTER_SOLVE}
        budget = StageBudget(checkpoint_start=clock.now - 60 * MINUTE)
        runner = make_runner(settings, executor, clock, budget)

        runner.run(AFTER_SOLVE, {})

        statuses = [r.status for r in runner.records]
        self.assertEqual(statuses[:3], ["ok", "ok", "ok"])
        self.assertEqual(set(statuses[3:]), {"skipped_budget"})
        self.assertGreater(runner.spent, 25 * MINUTE)

    def test_an_opt_in_stage_budget_stops_launches_after_that_much_stage_time(self):
        executor = RecordingExecutor({})
        clock = FakeClock(step=13 * MINUTE)
        settings = {name: StageSetting(True, name) for name in AFTER_SOLVE}
        budget = StageBudget(checkpoint_start=clock.now, stage_seconds=25 * MINUTE)
        runner = make_runner(settings, executor, clock, budget)

        runner.run(AFTER_SOLVE, {})

        statuses = [r.status for r in runner.records]
        self.assertEqual(statuses[:2], ["ok", "ok"])
        self.assertEqual(set(statuses[2:]), {"skipped_budget"})
        self.assertEqual(len(executor.calls), 2)

    def test_stages_stop_launching_when_3_minutes_remain_under_the_cap(self):
        clock = FakeClock()
        budget = StageBudget(checkpoint_start=clock.now - 118 * MINUTE)
        executor = RecordingExecutor({})
        runner = make_runner({"fix": StageSetting(True, "fix")}, executor, clock, budget)

        runner.run(("fix",), {})

        self.assertEqual(runner.records[0].status, "skipped_budget")
        self.assertEqual(executor.calls, [])

    def test_a_launched_stage_times_out_at_the_reserve_line(self):
        clock = FakeClock()
        budget = StageBudget(checkpoint_start=clock.now - 107 * MINUTE)
        executor = RecordingExecutor({})
        runner = make_runner({"fix": StageSetting(True, "fix")}, executor, clock, budget)

        runner.run(("fix",), {})

        self.assertEqual(executor.calls[0][2], 10 * MINUTE)


class StagesJsonTest(unittest.TestCase):
    def test_stages_json_carries_every_field_the_analysis_reads(self):
        executor = RecordingExecutor({"a": ExecResult(0, '{"outcome": "kept"}', False)})
        runner = make_runner({"audit": StageSetting(True, "a")}, executor)
        runner.run(("commit-ratchet", "audit"), {})

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stages.json"
            write_stages_json(path, 2, runner.records, mcp_tool_calls=3)
            raw = json.loads(path.read_text())

        self.assertEqual(raw["mcp_tool_calls"], 3)
        self.assertEqual(raw["checkpoint"], 2)
        audit = raw["stages"][1]
        for key in ("stage", "start", "end", "exit", "tokens", "usd", "items_in", "items_out"):
            self.assertIn(key, audit)
        self.assertEqual(audit["outcome"], "kept")


if __name__ == "__main__":
    unittest.main()
