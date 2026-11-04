"""The S6 cleanup runner (C-248) end to end over fake sessions: waves, the splice into the next wave's
base, the prompt, the one retry and the self-check overrun. Each test names the mutation it catches.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

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


class DollarCap(unittest.TestCase):
    def test_concurrent_retries_stop_within_one_session_of_the_cap(self):
        # mutation: the retry checked against the charged spend only, so every lane's retry starts (C-283)
        names, cap, usd = ["calc_a", "calc_b", "calc_c", "calc_d"], 1.0, 0.2
        first, retries = threading.Barrier(len(names)), threading.Barrier(len(names), timeout=2)

        def reworded(name):
            return lambda ws, gate: (first.wait(), to_table(name, "error: no such op ")(ws, gate))

        def restored(name):
            def edit(ws, gate):
                try:
                    retries.wait()
                except threading.BrokenBarrierError:
                    pass
                to_table(name)(ws, gate)
            return edit
        steps = FakeSteps({f"app.py:{n}": [reworded(n), restored(n)] for n in names}, usd=usd,
                          cases=[f"import app; app.{n}('zz', 1)" for n in names])
        root = tmp()
        run = Run("fixture", root / "run", SPECS, max_usd=cap, planner=chosen_planner)
        summary = execute(run, steps, write_app(root / "frozen", module(names)))
        self.assertLessEqual(summary["usd"], cap + usd)
        self.assertEqual(sum(len(p) for p in steps.prompts.values()), len(names) + 1)
        self.assertEqual(json.loads((run.out / "run.json").read_text())["usd"], summary["usd"])

    def test_no_cap_never_stops_on_spend_and_the_spend_is_still_reported(self):
        import math
        from runner.__main__ import usd_cap
        names = ["calc_a", "calc_b", "calc_c"]
        steps = FakeSteps({f"app.py:{n}": [to_table(n)] for n in names}, usd=5.0)
        root = tmp()
        run = Run("fixture", root / "run", SPECS, max_usd=usd_cap("none"), planner=chosen_planner)
        summary = execute(run, steps, write_app(root / "frozen", module(names)))
        self.assertEqual(usd_cap("none"), math.inf)
        self.assertEqual(usd_cap("0.25"), 0.25)
        self.assertEqual(len(steps.prompts), len(names))
        self.assertGreaterEqual(summary["usd"], 5.0 * len(names))

    def test_the_t3_reviewer_cost_counts_against_the_cap(self):
        # mutation: final_gate's review.usd never charged, so reviewer spend escapes --max-usd (C-284)
        from runner import run as runner_run
        real, reviewer_usd = runner_run.final_gate, 0.5

        def reviewed(*args, **kwargs):
            return {**real(*args, **kwargs), "review": {"usd": reviewer_usd}}
        steps = FakeSteps({"app.py:calc_a": [to_table("calc_a")]}, usd=0.01)
        with mock.patch.object(runner_run, "final_gate", reviewed):
            run, summary = run_fixture(steps, ["calc_a"])
        self.assertAlmostEqual(summary["usd"], 0.01 + reviewer_usd, places=6)
        self.assertAlmostEqual(run.spent, summary["usd"], places=6)


class DiffgateTimeouts(unittest.TestCase):
    def test_a_case_that_timed_out_on_either_side_is_inconclusive_not_a_difference(self):
        # mutation: counting a replay timeout as a behaviour change of the lane
        def case(name, base, head):
            return {"case": name, "status": "differs", "fields": ["rc"], "base": {"rc": base}, "head": {"rc": head}}
        changed = case("g3", 0, 2)
        settled = settle_timeouts({"pass": False, "differences": [case("g1", "timeout", 0), case("g2", 0, "timeout"), changed]})
        self.assertEqual((settled["pass"], settled["inconclusive"], settled["differences"]), (False, ["g1", "g2"], [changed]))
        self.assertTrue(settle_timeouts({"pass": False, "differences": [case("g1", 2, "timeout")]})["pass"])


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
