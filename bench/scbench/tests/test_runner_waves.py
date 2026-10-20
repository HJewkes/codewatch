"""The S6 cleanup runner's wave machinery (C-248): the function-level splice, the scheduler and the
integration gate's reverse-order revert. Each test names the mutation it catches.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from runner.integrate import integrate
from runner.schedule import LANES, next_wave, runnable, shared_wave
from runner.splice import segments, splice, write_tree
from tests.runner_fixtures import MESSAGE, FakeSteps, ladder, module, set_function, table, write_app

NAMES = ["calc_a", "calc_b", "calc_c"]


def tmp(case: unittest.TestCase) -> Path:
    held = tempfile.TemporaryDirectory()
    case.addCleanup(held.cleanup)
    return Path(held.name)


class Segments(unittest.TestCase):
    def test_segments_join_back_to_the_module_exactly(self):
        # mutation: a segment that drops the comment or blank lines above a def
        text = "import re\n\n\n# about a\ndef a():\n    pass\n\n\nclass K:\n    x = 1\n\n    def m(self):\n        pass\n"
        self.assertEqual("".join(t for _, t in segments(text)), text)
        cut = segments(text)
        self.assertEqual([k for k, _ in cut], ["|import re", "a", "class K", "K.=x", "K.m"])
        self.assertTrue(dict(cut)["a"].startswith("\n\n# about a\n"))


class Splice(unittest.TestCase):
    def setUp(self):
        self.names = [f"f{i}" for i in range(8)]
        self.base = {"app.py": module(self.names).encode()}

    def lane(self, names: list[str]) -> dict:
        return {"app.py": module(self.names, dict.fromkeys(names, MESSAGE)).encode()}

    def test_interleaved_lanes_in_one_file_splice_without_conflict(self):
        # mutation: a line-level merge, which conflicts on adjacent functions owned by different lanes
        heads = {"t1": self.lane(self.names[0::2]), "t2": self.lane(self.names[1::2])}
        out = splice(self.base, heads)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1", "t2"], {}))
        self.assertEqual(out["files"]["app.py"].decode(), module(self.names, dict.fromkeys(self.names, MESSAGE)))

    def test_new_functions_land_after_their_anchor(self):
        # mutation: additions appended at the end of the module instead of after their anchor
        head = module(self.names).replace("def f3(", "def f2_helper():\n    return 1\n\n\ndef f3(")
        out = splice(self.base, {"t1": {"app.py": head.encode()}, "t2": self.lane(["f5"])})
        text = out["files"]["app.py"].decode()
        self.assertLess(text.index("def f2("), text.index("def f2_helper"))
        self.assertLess(text.index("def f2_helper"), text.index("def f3("))
        self.assertIn(table("f5"), text)

    def test_two_lanes_changing_one_function_differently_drop_the_later_lane(self):
        # mutation: the later lane's text silently overwriting the earlier one
        other = {"app.py": module(self.names, {"f1": "error: other "}).encode()}
        out = splice(self.base, {"t1": self.lane(["f1"]), "t2": other})
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["app.py"]}))

    def test_lanes_that_together_leave_a_module_unparseable_are_reported_not_raised(self):
        # mutation: an unparseable merge escaping as an exception (module_units returns None)
        base = {"m.py": b"class K:\n    x = 1\n\n    def m(self):\n        pass\n"}
        heads = {"t1": {"m.py": b"class K:\n    def m(self):\n        pass\n"},
                 "t2": {"m.py": b"class K:\n    x = 1\n"}}
        out = splice(base, heads)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))

    def test_two_lanes_changing_a_non_python_file_differently_drop_the_later_lane(self):
        # mutation: a non-Python file taken from the first lane without comparing the others
        base = {"notes.txt": b"a\n"}
        out = splice(base, {"t1": {"notes.txt": b"b\n"}, "t2": {"notes.txt": b"c\n"}})
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["notes.txt"]}))
        self.assertEqual(out["files"]["notes.txt"], b"b\n")


class SpliceResultCheck(unittest.TestCase):
    """Every merged Python file parses and keeps each lane's changed segments, on every path."""

    def test_two_lanes_setting_one_constant_differently_drop_the_later_lane(self):
        # mutation: assignments keyed by their text, so X = 2 and X = 3 both land and the last one wins
        base = {"m.py": b"X = 1\n\n\ndef f():\n    return X\n"}
        heads = {"t1": {"m.py": b"X = 2\n\n\ndef f():\n    return X\n"},
                 "t2": {"m.py": b"X = 3\n\n\ndef f():\n    return X\n"}}
        out = splice(base, heads)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))
        self.assertEqual(out["files"]["m.py"], heads["t1"]["m.py"])

    def test_two_lanes_adding_one_new_constant_differently_drop_the_later_lane(self):
        # mutation: two new module-level tables under one name both spliced in
        base = {"m.py": b"def f():\n    return 1\n"}
        heads = {"t1": {"m.py": b"_STEPS = {'a': 1}\n\n\ndef f():\n    return 1\n"},
                 "t2": {"m.py": b"_STEPS = {'b': 2}\n\n\ndef f():\n    return 1\n"}}
        out = splice(base, heads)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))

    def test_an_unparseable_first_lane_is_the_one_dropped(self):
        # mutation: the fallback path keeping the first lane's broken file and blaming the valid lane
        base = {"m.py": b"def f():\n    return 1\n"}
        heads = {"t1": {"m.py": b"def (:\n"}, "t2": {"m.py": b"def f():\n    return 2\n"}}
        out = splice(base, heads)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t2"], {"t1": ["m.py"]}))
        self.assertEqual(out["files"]["m.py"], heads["t2"]["m.py"])

    def test_write_tree_leaves_no_file_of_an_earlier_splice(self):
        # mutation: a rerun into an existing wave dir keeping a file the new splice does not have
        root = tmp(self) / "tree"
        write_tree(root, {"a.py": b"a", "old.py": b"o"})
        write_tree(root, {"a.py": b"b"})
        self.assertEqual(sorted(p.name for p in root.iterdir()), ["a.py"])


class TextKeyedSplice(unittest.TestCase):
    """A statement keyed by its text (not a def, class or assignment) is one body-wide claim per lane."""

    DEF = "def main(code):\n    return code\n"

    def two(self, base: str, t1: str, t2: str) -> dict:
        return splice({"m.py": base.encode()}, {"t1": {"m.py": t1.encode()}, "t2": {"m.py": t2.encode()}})

    def guarded(self, call: str) -> str:
        return f"{self.DEF}\n\nif __name__ == '__main__':\n    {call}\n"

    def test_two_lanes_editing_the_main_guard_drop_the_later_lane(self):
        # mutation: text-keyed segments claimed per key, so main(1) and main(2) both land as two guards
        out = self.two(self.guarded("main(0)"), self.guarded("main(1)"), self.guarded("main(2)"))
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))
        self.assertEqual(out["files"]["m.py"].decode().count("if __name__"), 1)

    def test_one_lane_deleting_the_main_guard_and_another_editing_it_drop_the_later_lane(self):
        # mutation: the body claim built from additions only, so t1's deletion is silently lost
        out = self.two(self.guarded("main(0)"), self.DEF, self.guarded("main(2)"))
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))
        self.assertEqual(out["files"]["m.py"].decode(), self.DEF)

    def test_two_lanes_editing_a_guarded_import_drop_the_later_lane(self):
        # mutation: the body claim narrowed to `if` statements, so both try blocks land
        guard = "try:\n    import {0}\nexcept ImportError:\n    {0} = None\n\n\n" + self.DEF
        out = self.two(guard.format("json"), guard.format("ujson"), guard.format("simplejson"))
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))

    def test_two_lanes_editing_a_class_body_statement_drop_the_later_lane(self):
        # mutation: the body claim applied to module-level keys only, missing "K.|..." keys
        klass = "class K:\n    {0}\n\n    def m(self):\n        return 1\n"
        out = self.two(klass.format("pass"), klass.format("print(1)"), klass.format("print(2)"))
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))

    def test_a_text_keyed_edit_and_a_def_edit_in_one_file_both_splice(self):
        # mutation: the body claim counting def or assignment segments, so the def-only lane is dropped
        base = self.guarded("main(0)")
        bump = ("return code", "return code + 1")
        out = self.two(base, self.guarded("main(1)"), base.replace(*bump))
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1", "t2"], {}))
        self.assertEqual(out["files"]["m.py"].decode(), self.guarded("main(1)").replace(*bump))


class SpliceOrder(unittest.TestCase):
    """The result keeps each lane's segments in that lane's order, or the lane is a conflict."""

    BASE = "def p():\n    return 1\n\n\ndef q():\n    return 2\n\n\ndef r():\n    return 3\n"
    SWAPPED = "def q():\n    return 2\n\n\ndef p():\n    return 1\n\n\ndef r():\n    return 3\n"

    def run_lanes(self, base: str, *lanes: str) -> dict:
        return splice({"m.py": base.encode()}, {f"t{i + 1}": {"m.py": t.encode()} for i, t in enumerate(lanes)})

    def test_one_lane_moving_a_constant_below_the_def_it_calls_is_taken_whole(self):
        # mutation: a file one lane touches sent through the splice, which drops blank-line-only edits
        lane = "def f():\n    return 1\n\n\nX = f()\n\ndef g():\n    return 2\n"
        out = self.run_lanes("X = 1\n\n\ndef f():\n    return 1\n\n\ndef g():\n    return 2\n", lane)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {}))
        self.assertEqual(out["files"]["m.py"].decode(), lane)

    def test_one_lane_swapping_two_calls_keeps_the_swap(self):
        # mutation: a lane whose segments equal base's as a set treated as touching nothing, keeping base
        calls = "def a():\n    pass\n\n\ndef b():\n    pass\n\n\nreg({})\nreg({})\n"
        out = self.run_lanes(calls.format("a", "b"), calls.format("b", "a"))
        self.assertEqual(out["files"]["m.py"].decode(), calls.format("b", "a"))

    def test_a_reorder_of_segments_another_lane_left_alone_splices_with_it(self):
        # mutation: the order check without the other-lane exemption, so t1 fails on t2's swap
        out = self.run_lanes(self.BASE, self.BASE.replace("return 3", "return 30"), self.SWAPPED)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1", "t2"], {}))
        self.assertEqual(out["files"]["m.py"].decode(), self.SWAPPED.replace("return 3", "return 30"))

    def test_a_reorder_that_cannot_coexist_with_an_earlier_lane_drops_the_later_lane(self):
        # mutation: an order cycle blamed on the earlier lane, so t1's addition is dropped instead
        between = self.BASE.replace("def q(", "def n():\n    return 0\n\n\ndef q(")
        out = self.run_lanes(self.BASE, between, self.SWAPPED)
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["m.py"]}))
        self.assertEqual(out["files"]["m.py"].decode(), between)


class Schedule(unittest.TestCase):
    def plan(self) -> dict:
        tasks_ = [{"id": f"m:t{i}", "wave": 1} for i in range(6)] + [{"id": "m:outer", "wave": 2},
                                                                     {"id": "m:s", "wave": 1, "shared": True}]
        return {"tasks": tasks_}

    def test_shared_work_is_wave_one_on_one_lane(self):
        # mutation: shared tasks scheduled among the cluster lanes
        wave = shared_wave(self.plan())
        self.assertEqual(([t["id"] for t in wave["tasks"]], wave["lanes"]), (["m:s"], 1))

    def test_cluster_waves_run_inner_first_on_at_most_four_lanes(self):
        # mutation: the outer task in the first cluster wave, or a lane per task
        first = next_wave(self.plan(), {"m:s"})
        self.assertEqual((len(first["tasks"]), first["lanes"], first["plan_wave"]), (6, LANES, 1))
        second = next_wave(self.plan(), {"m:s"} | {t["id"] for t in first["tasks"]})
        self.assertEqual([t["id"] for t in second["tasks"]], ["m:outer"])

    def test_a_task_without_a_chosen_edit_gets_no_session_and_says_why(self):
        # mutation: a task the planner chose no edit for sent to a session anyway
        self.assertIsNone(runnable({"chosen": {"recipe": "table"}}))
        task = {"candidates": [{"rejected": ["t2"]}, {"rejected": ["t1", "t2"]}]}
        self.assertEqual(runnable(task), "no feasible edit: t1, t2")
        self.assertEqual(runnable({}), "no feasible edit: no candidate edit")


class IntegrationRevert(unittest.TestCase):
    def test_the_failing_lane_alone_is_reverted(self):
        # mutation: peeling from the end, which also reverts the innocent last lane
        root = tmp(self)
        base = write_app(root / "base", module(NAMES))
        lanes = {}
        for name in NAMES:
            ws = write_app(root / name, module(NAMES))
            set_function(ws, name, table(name, "error: POISON " if name == "calc_b" else MESSAGE))
            lanes[f"app.py:{name}"] = ws
        steps = FakeSteps(poison="POISON")
        out = integrate(steps, base, root / "wave", lanes)
        self.assertEqual(sorted(out["reverted"]), ["app.py:calc_b"])
        self.assertEqual([c["label"] for c in out["checks"]], ["all", "without-3", "without-2"])
        final = (Path(out["tree"]) / "app.py").read_text()
        self.assertIn(table("calc_a"), final)
        self.assertIn(ladder("calc_b"), final)

    def test_lanes_are_spliced_and_reverted_in_the_callers_order(self):
        # mutation: lanes sorted by id, so the revert peels the wrong lane first
        root = tmp(self)
        base = write_app(root / "base", module(NAMES))
        lanes = {}
        for name in reversed(NAMES):
            ws = write_app(root / name, module(NAMES))
            set_function(ws, name, table(name, "error: POISON " if name == "calc_a" else MESSAGE))
            lanes[f"app.py:{name}"] = ws
        out = integrate(FakeSteps(poison="POISON"), base, root / "wave", lanes)
        self.assertEqual(out["splice"]["spliced"], list(lanes))
        self.assertEqual([c["label"] for c in out["checks"]], ["all", "without-3"])
        self.assertEqual(list(out["reverted"]), ["app.py:calc_a"])


if __name__ == "__main__":
    unittest.main()
