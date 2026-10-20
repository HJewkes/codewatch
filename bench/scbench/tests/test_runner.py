"""The S6 cleanup runner (C-248) end to end over fake sessions: waves, the splice into the next wave's
base, the prompt, the one retry and the self-check overrun. Each test names the mutation it catches.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from ledger import ledger_path, read, tasks
from runner import prompt
from runner.container import settle_timeouts
from runner.run import Run, execute
from tests.runner_fixtures import (
    BENCH,
    MESSAGE,
    FakeSteps,
    chosen_planner,
    gate_env,
    module,
    set_function,
    table,
    write_app,
)

NAMES = ["calc_a", "calc_b", "calc_c"]
SPECS = ["# cp1\nThe tool adds a step to x.\n", "# cp2\nUnknown ops fail with `error: unknown op <op>`.\n"]


def tmp() -> Path:
    return Path(tempfile.mkdtemp())


def to_table(name: str, message: str = MESSAGE):
    return lambda ws, gate: set_function(ws, name, table(name, message))


def run_fixture(steps: FakeSteps, names: list[str] = NAMES) -> tuple[Run, dict]:
    root = tmp()
    frozen = write_app(root / "frozen", module(names))
    run = Run("fixture", root / "run", SPECS, planner=chosen_planner)
    return run, execute(run, steps, frozen)


class EndToEnd(unittest.TestCase):
    def test_a_run_writes_waves_spliced_tree_and_one_row_per_task(self):
        # mutation: lanes run but not spliced, so the next wave's base is unchanged
        steps = FakeSteps({f"app.py:{n}": [to_table(n)] for n in NAMES})
        run, summary = run_fixture(steps)
        self.assertEqual([w["kind"] for w in summary["waves"]], ["shared", "cluster"])
        wave = summary["waves"][1]
        self.assertEqual((wave["lanes"], wave["splice"]["conflicts"], wave["reverted"]), (3, {}, {}))
        self.assertTrue(all(a["tree_changed"] for s in wave["sessions"] for a in s["attempts"]))
        rows = tasks(read(ledger_path(run.out)))
        self.assertEqual(sorted((r["cluster"], r["outcome"], r["kept"]) for r in rows),
                         [(f"app.py:{n}", "accept", True) for n in NAMES])
        self.assertEqual((Path(summary["final_tree"]) / "app.py").read_text(), module(NAMES, dict.fromkeys(NAMES, MESSAGE)))

    def test_the_prompt_carries_specs_one_pass_condition_and_the_one_tool(self):
        # mutation: a gate list in the prompt, or a missing spec
        steps = FakeSteps({"app.py:calc_a": [to_table("calc_a")]})
        run_fixture(steps, ["calc_a"])
        [text] = steps.prompts["app.py:calc_a"]
        self.assertTrue(all(s.strip() in text for s in SPECS))
        self.assertEqual(text.count("pass_condition:"), 1)
        self.assertIn("still holds unless a later checkpoint changes it", text)
        self.assertIn("do not use\n  `sleep`", text)
        self.assertIn("scbench gate --cluster app.py:calc_a", text)
        self.assertNotIn("diffgate", text)


class Retry(unittest.TestCase):
    def test_a_reworded_message_gets_one_restore_retry_and_then_passes(self):
        # mutation: a retry message that is not the deterministic "restore these messages verbatim" form
        steps = FakeSteps({"app.py:calc_a": [to_table("calc_a", "error: no such op "), to_table("calc_a")]},
                          cases=["import app; app.calc_a('zz', 1)"])
        run, summary = run_fixture(steps, ["calc_a"])
        [lane] = summary["waves"][1]["sessions"]
        self.assertEqual([(a["outcome"], a["diffgate_pass"]) for a in lane["attempts"]], [("reject", False), ("accept", True)])
        message = (run.out / "wave2" / "app.py__calc_a" / "retry_message.txt").read_text().strip()
        self.assertEqual(message, prompt.RESTORE + json.dumps("ValueError: error: unknown op zz"))
        self.assertIn(message, steps.prompts["app.py:calc_a"][1])
        [row] = tasks(read(ledger_path(run.out)))
        self.assertEqual((row["outcome"], row["retry_used"]), ("accept", True))


class DiffgateTimeouts(unittest.TestCase):
    def test_a_case_that_timed_out_on_the_base_is_inconclusive_not_a_difference(self):
        # mutation: counting a base-side timeout as a behaviour change of the lane
        timeout = {"case": "g1", "status": "differs", "fields": ["rc"], "base": {"rc": "timeout"}, "head": {"rc": 0}}
        changed = {"case": "g2", "status": "differs", "fields": ["rc"], "base": {"rc": 0}, "head": {"rc": "timeout"}}
        self.assertEqual(settle_timeouts({"pass": False, "differences": [timeout]})["pass"], True)
        settled = settle_timeouts({"pass": False, "differences": [timeout, changed]})
        self.assertEqual((settled["pass"], settled["inconclusive"], settled["differences"]), (False, ["g1"], [changed]))


class SelfCheckOverrun(unittest.TestCase):
    def test_calls_refused_past_the_budget_reach_the_ledger(self):
        # mutation: taking `refused` from gate/'s call log, which keeps only the granted calls
        def four_checks(ws, gate):
            for _ in range(4):
                subprocess.run([str(BENCH / "runner" / "scbench.sh"), "gate", "--cluster", "app.py:calc_a"],
                               cwd=ws, env=gate_env(gate), capture_output=True, check=False)
            to_table("calc_a")(ws, gate)
        run, _ = run_fixture(FakeSteps({"app.py:calc_a": [four_checks]}), ["calc_a"])
        [row] = tasks(read(ledger_path(run.out)))
        self.assertEqual(row["self_check"], {"calls": 3, "budget": 3, "refused": 1, "overrun": True})


if __name__ == "__main__":
    unittest.main()
