import ast
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from planner import graph, plan_tree
from planner.cutwidth import cut_width
from planner.report import cluster_numbers
from planner.tasks import ownership_conflicts
from planner.units import dilution, module_units
from tests.planner_fixtures import AGGREGATE_ARM, PARSER, WIDE, ladder

BENCH = Path(__file__).resolve().parent.parent


def write(root, files):
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    return root


class TreeCase(unittest.TestCase):
    def tree(self, files):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return write(Path(tmp.name), files)

    def plan(self, files, **kw):
        return plan_tree(self.tree(files), **kw)

    @staticmethod
    def task(plan, key):
        return next(t for t in plan["tasks"] if t["id"] == key)

    @staticmethod
    def owned(task):
        return [row["key"] for row in task["owned"]]


DISPATCH = ("HANDLERS = {'a': _a, 'b': [_b]}\n\n\n" + ladder("_a", 1) + ladder("_b", 1) + ladder("_c", 1)
            + ladder("_d", 1) + ladder("run", 11, ("_d",)).replace("    return x\n", "    table = (_c, _d)\n"
                                                                    "    return HANDLERS[x](table)\n"))


class DispatchTableEdges(TreeCase):
    def test_functions_named_in_a_module_table_or_a_local_literal_join_the_readers_task(self):
        units, edges = graph(self.tree({"m.py": DISPATCH}))
        self.assertEqual(edges["m.py:run"], {"m.py:_a": "dispatch", "m.py:_b": "dispatch", "m.py:_c": "dispatch",
                                             "m.py:_d": "calls"})
        task = self.task(self.plan({"m.py": DISPATCH}), "m.py:run")
        self.assertEqual(self.owned(task), ["m.py:run", "m.py:_a", "m.py:_b", "m.py:_c", "m.py:_d"])

    def test_without_the_table_the_helpers_would_be_roots(self):
        plain = DISPATCH.replace("HANDLERS = {'a': _a, 'b': [_b]}", "HANDLERS = {}").replace("(_c, _d)", "()")
        task = self.task(self.plan({"m.py": plain}), "m.py:run")
        self.assertEqual(self.owned(task), ["m.py:run", "m.py:_d"])


NESTED = {"m.py": ladder("leaf", 1) + ladder("inner", 11, ("leaf",)) + ladder("mid", 2, ("inner",))
          + ladder("outer", 12, ("mid",)) + ladder("other", 11, ("util",)) + ladder("util", 1)
          + ladder("top", 1, ("outer", "other", "util"))}


class InnerFirstWaves(TreeCase):
    def setUp(self):
        self.result = self.plan(NESTED)

    def test_a_hot_function_inside_another_hot_subtree_is_its_own_task_one_wave_earlier(self):
        inner, outer = self.task(self.result, "m.py:inner"), self.task(self.result, "m.py:outer")
        self.assertEqual((inner["wave"], outer["wave"]), (1, 2))
        self.assertEqual(self.owned(inner), ["m.py:inner", "m.py:leaf"])
        self.assertEqual(self.owned(outer), ["m.py:outer", "m.py:mid"])
        self.assertEqual(self.result["waves"], [["m.py:inner", "m.py:other"], ["m.py:outer"]])

    def test_the_outer_task_sees_the_inner_head_as_frozen(self):
        self.assertEqual(self.task(self.result, "m.py:outer")["frozen"], [{"key": "m.py:inner", "why": "inner head"}])
        self.assertEqual(self.task(self.result, "m.py:outer")["head_signature"], "frozen")

    def test_ownership_is_disjoint_per_wave_and_unowned_callers_stay_out(self):
        self.assertEqual(ownership_conflicts(self.result), [])
        owned = [k for t in self.result["tasks"] for k in self.owned(t)]
        self.assertEqual(len(owned), len(set(owned)))
        self.assertNotIn("m.py:top", owned)

    def test_a_conflict_is_reported(self):
        clash = {"tasks": [{"id": "a", "wave": 1, "owned": [{"key": "k"}]}, {"id": "b", "wave": 1, "owned": [{"key": "k"}]}]}
        self.assertEqual(ownership_conflicts(clash), ["wave 1: k owned by a and b"])


class SharedCalleesAndModuleLines(TreeCase):
    def test_a_callee_two_tasks_call_is_frozen_for_both_and_owned_by_neither(self):
        files = {"m.py": ladder("util", 1) + ladder("one", 11, ("util",)) + ladder("two", 11, ("util",))}
        result = self.plan(files)
        self.assertEqual(result["shared_callees"], ["m.py:util"])
        for head in ("m.py:one", "m.py:two"):
            self.assertEqual(self.owned(self.task(result, head)), [head])
            self.assertEqual(self.task(result, head)["frozen"], [{"key": "m.py:util", "why": "shared"}])

    def test_clusters_are_cut_at_module_lines(self):
        files = {"a.py": "from b import helper\n\n\n" + ladder("hot", 11, ("helper",)), "b.py": ladder("helper", 1)}
        task = self.task(self.plan(files), "a.py:hot")
        self.assertEqual(self.owned(task), ["a.py:hot"])
        self.assertEqual(task["frozen"], [{"key": "b.py:helper", "why": "unowned"}])


class OwnBodyComplexity(unittest.TestCase):
    def test_nested_defs_are_excluded_and_lambdas_count_with_scb_beside(self):
        text = ("def f(x):\n    g = lambda y: 1 if y else 2\n    def h(z):\n        if z:\n            return z\n"
                "    if x:\n        return g(x)\n    return h\n")
        _, units = module_units("m.py", text)
        f, h = units
        self.assertEqual((f.qual, f.cc, f.cc_scb, f.sloc), ("f", 3, 4, 5))
        self.assertEqual((h.qual, h.cc, h.sloc), ("f.h", 2, 3))


class TokenCap(TreeCase):
    def test_a_task_over_the_cap_is_split_along_its_subtrees_and_reported(self):
        files = {"m.py": ladder("a", 3) + ladder("b", 3, ("a",)) + ladder("c", 3) + ladder("hot", 11, ("b", "c"))}
        result = self.plan(files, cap=80)
        task = self.task(result, "m.py:hot")
        self.assertTrue(task["over_cap"])
        self.assertEqual([p["members"] for p in task["split"]], [["m.py:hot"], ["m.py:a", "m.py:b"], ["m.py:c"]])
        self.assertTrue(all(p["tokens"] <= 80 for p in task["split"][1:]))
        self.assertFalse(self.task(self.plan(files), "m.py:hot")["over_cap"])


class WorkedExampleSelectItem(TreeCase):
    """B8.2: CC 26, 55 SLOC, 0 params; owns only itself; every callee frozen; wave 1 of 2; narrow stage."""

    def setUp(self):
        self.root = self.tree({"p.py": PARSER})
        self.result = plan_tree(self.root)
        self.select = self.task(self.result, "p.py:Parser.select_item")

    def test_head_numbers_and_task_shape(self):
        self.assertEqual({k: self.select["head"][k] for k in ("cc", "sloc", "params")}, {"cc": 26, "sloc": 55, "params": 0})
        self.assertEqual(self.owned(self.select), ["p.py:Parser.select_item"])
        callees = ["at_slot", "err", "field_ref", "is_word", "next", "peek", "value_expr"]
        self.assertEqual(self.select["frozen"], [{"key": f"p.py:Parser.{c}", "why": "shared"} for c in callees])
        self.assertEqual((self.select["wave"], len(self.result["waves"])), (1, 2))

    def test_the_aggregate_arm_is_a_narrow_cut(self):
        lines = PARSER.splitlines()
        start = next(i for i, line in enumerate(lines, 1) if AGGREGATE_ARM[0] in line) + 1
        end = next(i for i, line in enumerate(lines, 1) if AGGREGATE_ARM[1] in line)
        units, _ = graph(self.root)
        width = cut_width(units["p.py:Parser.select_item"].node, start, end)
        self.assertEqual((width["in"], width["out"], width["mutated"], width["width"]), (["t"], ["item"], [], 2))


class CutWidth(unittest.TestCase):
    def test_a_wide_cut_threads_the_caller_locals_and_hands_back_mutations(self):
        fn = ast.parse(WIDE).body[0]
        width = cut_width(fn, 4, 6)
        self.assertEqual(width["in"], ["header", "limit", "lines", "rows", "sep", "total"])
        self.assertEqual((width["out"], width["mutated"], width["width"]), (["total"], ["lines"], 8))

    def test_a_name_bound_before_its_read_inside_the_range_is_not_live_in(self):
        fn = ast.parse(WIDE).body[0]
        self.assertEqual(cut_width(fn, 2, 3), {"range": [2, 3], "in": [], "out": ["lines", "total"], "mutated": [],
                                               "width": 2})


class ReportKeyedByTaskClusters(TreeCase):
    def test_new_helpers_join_the_task_of_the_function_they_were_cut_from(self):
        before = self.tree({"m.py": ladder("_h", 1) + ladder("big", 13, ("_h",)) + ladder("loose", 2)})
        after = self.tree({"m.py": ladder("_h", 1) + ladder("_new", 6) + ladder("big", 6, ("_h", "_new"))
                           + ladder("loose", 3)})
        fb, fa = ([f for m in dilution.scan(r) for f in m.functions] for r in (before, after))
        touched = dilution.touched(fb, fa)
        out = cluster_numbers(before, after, fb, fa, touched)
        self.assertEqual(out["tasks"], ["m.py:big"])
        self.assertEqual(out["by_task"]["m.py:big"]["before"], ["m.py:big", "m.py:_h"])
        self.assertEqual(out["by_task"]["m.py:big"]["after"], ["m.py:_h", "m.py:_new", "m.py:big"])
        self.assertEqual(out["untasked"], ["m.py:loose"])
        self.assertEqual([n["total"] for n in out["numbers"]], [14 + 2, 7 + 7 + 2])


class ByteStablePlans(TreeCase):
    def test_two_runs_under_different_hash_seeds_print_identical_bytes(self):
        root = self.tree({"p.py": PARSER, "m.py": DISPATCH, "n/q.py": NESTED["m.py"]})
        runs = [subprocess.run([sys.executable, "-m", "planner", "plan", str(root)], cwd=BENCH, capture_output=True,
                               check=True, env={**os.environ, "PYTHONHASHSEED": seed}).stdout for seed in ("1", "2")]
        self.assertEqual(runs[0], runs[1])
        self.assertIn(b'"waves"', runs[0])


if __name__ == "__main__":
    unittest.main()
