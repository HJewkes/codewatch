import json
import tempfile
import unittest
from pathlib import Path

from agent.stages import (
    AFTER_SOLVE,
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
    def test_inject_runs_only_from_the_second_checkpoint(self):
        self.assertEqual(stages_for(1, before_solve=True), ())
        self.assertEqual(stages_for(2, before_solve=True), ("inject",))

    def test_after_solve_stages_run_in_design_order_every_checkpoint(self):
        self.assertEqual(
            stages_for(1, before_solve=False),
            ("index", "audit", "replay", "triage", "remediation", "synthesis"),
        )


class StageRunnerTest(unittest.TestCase):
    def test_disabled_and_commandless_stages_are_recorded_without_running(self):
        executor = RecordingExecutor({})
        runner = make_runner({"audit": StageSetting(enabled=True)}, executor)

        runner.run(AFTER_SOLVE, {})

        statuses = {r.stage: r.status for r in runner.records}
        self.assertEqual(statuses["audit"], "missing")
        self.assertEqual(statuses["index"], "disabled")
        self.assertEqual(executor.calls, [])
        self.assertTrue(all(r.exit is None for r in runner.records))

    def test_stage_report_line_fills_metrics_and_passthrough_fields(self):
        report = {"tokens": 900, "usd": 0.31, "items_in": 5, "items_out": 4,
                  "outcome": "kept", "fixed_replay_diffs": 1,
                  "added_symbols": [{"path": "src/a.py", "name": "_h", "flags": ["x"]}]}
        stdout = "progress\n" + json.dumps(report) + "\n"
        executor = RecordingExecutor({"fix": ExecResult(0, stdout, False)})
        runner = make_runner({"remediation": StageSetting(True, "fix")}, executor, FakeClock(step=30))

        runner.run(("remediation",), {"CW_CHECKPOINT": "3"})

        row = runner.records[0].to_json()
        self.assertEqual(row["status"], "ok")
        self.assertEqual(row["exit"], 0)
        self.assertEqual((row["tokens"], row["usd"], row["items_in"], row["items_out"]), (900, 0.31, 5, 4))
        self.assertEqual(row["outcome"], "kept")
        self.assertEqual(row["added_symbols"][0]["flags"], ["x"])
        self.assertLess(row["start"], row["end"])
        self.assertEqual(executor.calls[0][1], {"CW_CHECKPOINT": "3", "CW_STAGE": "remediation"})

    def test_a_failing_stage_is_logged_and_later_stages_still_run(self):
        executor = RecordingExecutor({"boom": RuntimeError("docker gone"), "bad": ExecResult(2, "", False)})
        settings = {"index": StageSetting(True, "boom"), "audit": StageSetting(True, "bad"),
                    "replay": StageSetting(True, "ok")}
        logs = []
        runner = make_runner(settings, executor, logs=logs)

        runner.run(("index", "audit", "replay"), {})

        rows = [r.to_json() for r in runner.records]
        self.assertEqual([r["status"] for r in rows], ["failed", "failed", "ok"])
        self.assertIn("docker gone", rows[0]["error"])
        self.assertEqual(rows[1]["exit"], 2)
        self.assertEqual([kw["stage"] for _, kw in logs], ["index", "audit"])

    def test_a_timed_out_stage_is_recorded_as_timeout(self):
        executor = RecordingExecutor({"slow": ExecResult(None, "", True)})
        runner = make_runner({"triage": StageSetting(True, "slow")}, executor)

        runner.run(("triage",), {})

        self.assertEqual(runner.records[0].status, "timeout")


class StageBudgetTest(unittest.TestCase):
    def test_stages_stop_launching_after_25_minutes_of_stage_time(self):
        executor = RecordingExecutor({})
        clock = FakeClock(step=13 * MINUTE)
        settings = {name: StageSetting(True, name) for name in AFTER_SOLVE}
        runner = make_runner(settings, executor, clock)

        runner.run(AFTER_SOLVE, {})

        statuses = [r.status for r in runner.records]
        self.assertEqual(statuses[:2], ["ok", "ok"])
        self.assertEqual(set(statuses[2:]), {"skipped_budget"})
        self.assertEqual(len(executor.calls), 2)

    def test_stages_stop_launching_when_20_minutes_remain_under_the_cap(self):
        clock = FakeClock()
        budget = StageBudget(checkpoint_start=clock.now - 100 * MINUTE)
        executor = RecordingExecutor({})
        runner = make_runner({"index": StageSetting(True, "index")}, executor, clock, budget)

        runner.run(("index",), {})

        self.assertEqual(runner.records[0].status, "skipped_budget")
        self.assertEqual(executor.calls, [])

    def test_a_launched_stage_times_out_at_the_reserve_line(self):
        clock = FakeClock()
        budget = StageBudget(checkpoint_start=clock.now - 90 * MINUTE)
        executor = RecordingExecutor({})
        runner = make_runner({"index": StageSetting(True, "index")}, executor, clock, budget)

        runner.run(("index",), {})

        self.assertEqual(executor.calls[0][2], 10 * MINUTE)


class StagesJsonTest(unittest.TestCase):
    def test_stages_json_carries_every_field_the_analysis_reads(self):
        executor = RecordingExecutor({"a": ExecResult(0, '{"outcome": "kept"}', False)})
        runner = make_runner({"audit": StageSetting(True, "a")}, executor)
        runner.run(("index", "audit"), {})

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
