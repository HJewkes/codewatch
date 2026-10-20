"""The S5 cleanup ledger (C-248): rows, the start rules, the T2 re-inline check and the roll-ups.

Each fixture test names the mutation it catches.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from gate import __main__ as gate_cli
from gate.family import check_trees
from gate.gates import final_gate
from ledger import __main__ as cli
from ledger import append, judgement, judgements, ledger_path, read, tasks
from ledger.columns import self_check, skip_row, task_row
from ledger.rollup import RETIRE, rollup
from ledger.rules import at_start, digest, reinlined, repeat
from planner.families import load_config
from tests.gate_fixtures import BASE, COSMETIC, NARROW, write_tree
from tests.test_gate import GREEN, replies

CFG = load_config()
RUN = {"id": "run-1"}
TASK = {"id": "app.py:handle", "wave": 1, "owned": [{"key": "app.py:handle"}],
        "chosen": {"gain": 12.0, "edits": ["e1"]}, "candidates": [{"id": "e1", "recipe": "R1"}]}
SPLIT = "app.py:_size_label"
COLUMNS = {"task_type", "cluster", "projected_gain", "realised_gain", "structural_cost", "usd", "gates", "retry_used",
           "next_checkpoint", "families", "self_check", "wave", "integration_revert"}


def texts(source: str) -> dict[str, str]:
    return {"app.py": source}


def gate_result(base: str, head: str, outcome: str = "accept") -> dict:
    report = check_trees(texts(base), texts(head), TASK, CFG)
    return {"outcome": outcome, "tier": "T2", "reasons": [], "report": report}


def row(result: dict, head: str, **facts) -> dict:
    return task_row(RUN, TASK, result, {"usd": 0.5, **facts}, texts(head), CFG)


def reject(cluster: str, failed: list[str], bag: bool = False) -> dict:
    return {"kind": "task", "run": "run-1", "cluster": cluster, "task_type": "R1", "outcome": "reject",
            "kept": False, "usd": 0.4, "projected_gain": 5.0, "realised_gain": 0.0, "integration_revert": None,
            "families": {"failed": failed}, "gates": {"param_bag": bag}}


class Rows(unittest.TestCase):
    def test_a_gated_task_writes_one_row_with_every_column(self):
        tmp = Path(tempfile.mkdtemp())
        base, head = write_tree(tmp / "base", BASE, "def test_x():\n    assert True\n"), write_tree(
            tmp / "head", NARROW, "def test_x():\n    assert True\n")
        result = final_gate(base, head, TASK, CFG, GREEN, GREEN, replies())
        path = ledger_path(tmp / "run")
        append(path, row(result, NARROW, retry_used=True))
        [got] = tasks(read(path))
        self.assertLessEqual(COLUMNS, set(got))
        self.assertEqual((got["task_type"], got["outcome"], got["kept"], got["next_checkpoint"]), ("R1", "accept", True, None))
        self.assertEqual(got["new"], [SPLIT])
        self.assertEqual(got["families"]["tolerances"]["module"], CFG["p5"]["module_lines_per_new_function"])
        self.assertEqual(got["families"]["tolerances"]["size"], CFG["p5"]["size"])

    def test_the_cli_rolls_up_a_run_directory(self):
        tmp = Path(tempfile.mkdtemp())
        append(ledger_path(tmp), row(gate_result(BASE, NARROW), NARROW))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main([str(tmp)]), 0)
        self.assertEqual(json.loads(out.getvalue())["types"]["R1"]["accepted"], 1)


class Stale(unittest.TestCase):
    """Mutation caught: dropping the hot_cc re-check in rules.stale (a finding already fixed would run)."""

    def test_a_head_no_longer_hot_is_skipped(self):
        reason = at_start([], TASK, "R1", texts(NARROW), CFG)
        self.assertRegex(reason, r"^stale: app.py:handle CC \d+ is no longer over 10$")
        self.assertEqual(skip_row(RUN, TASK, reason)["outcome"], "skip")

    def test_a_head_that_is_gone_is_skipped(self):
        self.assertIn("no longer exists", at_start([], TASK, "R1", texts("def other():\n    pass\n"), CFG))

    def test_a_finding_that_still_holds_runs(self):
        self.assertIsNone(at_start([], TASK, "R1", texts(BASE), CFG))


class Repeat(unittest.TestCase):
    """Mutation caught: dropping the symbol-digest comparison in rules.repeat (a changed symbol stays suppressed)."""

    def setUp(self):
        self.kept = [{"kept": True, "symbol": TASK["id"], "task_type": "R1", "run": "run-0",
                      "symbol_digest": digest(texts(BASE), TASK["id"])}]

    def test_a_kept_symbol_and_type_is_suppressed_while_unchanged(self):
        self.assertIn("repeat: app.py:handle was kept as R1 in run run-0", at_start(self.kept, TASK, "R1", texts(BASE), CFG))

    def test_a_changed_symbol_runs_again(self):
        self.assertIsNone(at_start(self.kept, TASK, "R1", texts(COSMETIC), CFG))

    def test_another_type_on_the_same_symbol_runs(self):
        self.assertIsNone(at_start(self.kept, TASK, "R3", texts(BASE), CFG))


class Reinline(unittest.TestCase):
    """Mutation caught: dropping the `kept` filter in rules.reinlined (a rejected split would block its inline)."""

    def setUp(self):
        self.split = row(gate_result(BASE, NARROW), NARROW)
        self.inline = gate_result(NARROW, BASE)

    def test_inlining_a_kept_split_is_a_t2_reject(self):
        reasons = reinlined([self.split], self.inline["report"])
        self.assertEqual(reasons, [f"re-inlines {SPLIT}, split out by app.py:handle (run run-1)"])
        got = task_row(RUN, TASK, self.inline, {}, texts(BASE), CFG, reasons)
        self.assertEqual((got["outcome"], got["gates"]["tier"], got["kept"]), ("reject", "T2", False))
        self.assertIn(reasons[0], got["gates"]["reasons"])

    def test_a_split_that_was_not_kept_does_not_block(self):
        self.assertEqual(reinlined([{**self.split, "kept": False}], self.inline["report"]), [])


class SelfCheckBudget(unittest.TestCase):
    """Mutation caught: deriving the overrun from calls >= budget (a task using exactly 3 calls is no overrun)."""

    def test_a_refused_call_past_the_budget_is_an_overrun(self):
        log = Path(tempfile.mkdtemp()) / "calls.json"
        granted = [gate_cli.take_call(log, TASK["id"]) for _ in range(gate_cli.MAX_CALLS + 1)]
        self.assertEqual(granted, [1, 2, 3, None])
        self.assertEqual(self_check(log, TASK["id"], refused=1),
                         {"calls": 3, "budget": 3, "refused": 1, "overrun": True})

    def test_using_the_whole_budget_is_not_an_overrun(self):
        log = Path(tempfile.mkdtemp()) / "calls.json"
        for _ in range(gate_cli.MAX_CALLS):
            gate_cli.take_call(log, TASK["id"])
        got = row(gate_result(BASE, NARROW), NARROW, calls_log=log)["self_check"]
        self.assertEqual((got["calls"], got["overrun"]), (3, False))


class IntegrationRevert(unittest.TestCase):
    """Mutation caught: setting `kept` from the gate outcome alone (a reverted task would count and suppress)."""

    def test_a_reverted_accept_is_not_kept_counted_or_suppressing(self):
        got = row(gate_result(BASE, NARROW), NARROW, integration_revert=True)
        self.assertEqual((got["outcome"], got["kept"], got["integration_revert"]), ("accept", False, True))
        r1 = rollup([got], [])["types"]["R1"]
        self.assertEqual((r1["tasks"], r1["accepted"], r1["reverted"], r1["usd_per_accepted"]), (1, 0, 1, None))
        self.assertIsNone(repeat([got], TASK, "R1", texts(NARROW)))


class FalseRejects(unittest.TestCase):
    """Mutation caught: letting a later T3 judgement override the owner's in rollup.final_judgements."""

    def test_rejects_later_judged_good_roll_up_per_family_with_the_bag_apart(self):
        rows = [reject("a.py:f", ["size"]), reject("a.py:g", ["size", "iface"]), reject("a.py:h", [], bag=True),
                reject("a.py:k", ["cx"])]
        judged = [judgement("run-1", "a.py:f", "T3", True), judgement("run-1", "a.py:g", "owner", False),
                  judgement("run-1", "a.py:g", "T3", True), judgement("run-1", "a.py:h", "owner", True)]
        got = rollup(rows, judgements(judged))["false_rejects"]
        self.assertEqual(got["families"]["size"], {"rejects": 2, "judged_good": 1, "by": {"T3": 1},
                                                   "clusters": ["run-1/a.py:f"]})
        self.assertEqual((got["families"]["iface"]["judged_good"], got["families"]["cx"]["judged_good"]), (0, 0))
        self.assertEqual(got["evidence"]["param_bag"], {"rejects": 1, "judged_good": 1, "by": {"owner": 1},
                                                        "clusters": ["run-1/a.py:h"]})
        self.assertEqual(sum(f["rejects"] for f in got["families"].values()), 4)

    def test_a_judgement_names_t3_or_the_owner(self):
        with self.assertRaises(ValueError):
            judgement("run-1", "a.py:f", "reviewer", True)


class Retirement(unittest.TestCase):
    def test_a_type_retires_on_a_low_pass_rate_once_it_has_enough_tasks(self):
        rows = [reject(f"a.py:f{i}", ["size"]) for i in range(RETIRE["min_tasks"])]
        [got] = rollup(rows, [])["retirement"]
        self.assertEqual((got["type"], got["retire"], got["pass_rate"]), ("R1", True, 0.0))
        [young] = rollup(rows[:-1], [])["retirement"]
        self.assertFalse(young["retire"])


if __name__ == "__main__":
    unittest.main()
