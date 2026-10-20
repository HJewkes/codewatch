import ast
import tempfile
import unittest
from pathlib import Path

from planner import endstate, plan_tree, scan
from planner.classes import class_facts
from planner.detect import detect
from planner.families import load_config, profile, verdict
from planner.modules import structure, violations
from planner.rank import Search, candidates, exclusive
from planner.tasks import ownership_conflicts
from planner.units import module_units
from tests.planner_fixtures import DETECT, INLINE_OVER, PARSER, ROUTE, TWIN_ARMS

CFG = load_config()
# Round 3's knots (approximate cognitive port), on which the plan's worked example (B8.2) was computed.
ROUND3 = {**CFG, "risk": {**CFG["risk"], "knots": {**CFG["risk"]["knots"], "cognitive": [0, 13, 18, 29]}}}


class TreeCase(unittest.TestCase):
    def tree(self, files):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for rel, text in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text)
        return root

    def only_task(self, files):
        return plan_tree(self.tree(files))["tasks"][0]


class Recipes(TreeCase):
    def test_a_dispatch_ladder_becomes_a_table_that_behaves_the_same(self):
        root = self.tree({"m.py": ROUTE})
        trees, units, edges = scan(root)
        r1 = next(c for c in candidates([units["m.py:route"]], "m.py:route", edges, CFG) if c.recipe == "R1")
        after = ast.unparse(endstate.apply(trees["m.py"], [r1]))
        old, new = {}, {}
        exec(ROUTE, old)
        exec(after, new)
        for kind in ("sum", "max", "min", "low", "count"):
            self.assertEqual(old["route"](kind, [3, -1, 5], 2), new["route"](kind, [3, -1, 5], 2))
        self.assertIn("'low': _route_min", after)

    def test_an_inline_that_pushes_the_caller_over_cc_10_loses(self):
        task = self.only_task({"m.py": INLINE_OVER})
        inline = next(c for c in task["candidates"] if c["recipe"] == "R4")
        self.assertLess(inline["gain"], 0)
        self.assertIn("no gain", inline["rejected"])
        self.assertIsNone(task["chosen"])

    def test_of_two_exclusive_edits_the_higher_total_wins(self):
        root = self.tree({"m.py": TWIN_ARMS})
        trees, units, edges = scan(root)
        cands = candidates([units["m.py:big"]], "m.py:big", edges, CFG)
        merge = next(c for c in cands if c.recipe == "R2")
        stage = next(c for c in cands if c.recipe == "R3" and c.span[0] > merge.span[0] and c.span[1] < merge.span[1])
        search = Search("m.py", trees["m.py"], trees, CFG)
        alone = {c.id: search.score([c]) for c in (merge, stage)}
        self.assertTrue(exclusive(merge, stage))
        self.assertTrue(all(s["feasible"] for s in alone.values()))
        self.assertGreater(alone[merge.id]["score"], alone[stage.id]["score"])
        _, best = search.best(cands)
        self.assertIn(merge.id, best["edits"])
        self.assertNotIn(stage.id, best["edits"])

    def test_the_search_combines_edits_that_pass_the_floor_only_together(self):
        task = self.only_task({"m.py": ROUTE})
        singles = {c["id"]: c for c in task["candidates"]}
        self.assertTrue(all("floor" in singles[e]["rejected"] for e in task["chosen"]["edits"]))
        self.assertEqual(len(task["chosen"]["edits"]), 2)
        self.assertGreaterEqual(task["chosen"]["gain"] / 2, CFG["floor_gain_per_new_function"])


SELECT_ITEM = {"cc": 26, "cognitive": 33, "sloc": 55, "params": 0}


def stages(params: int) -> list[dict]:
    head = {"cc": 5, "cognitive": 6, "sloc": 16, "params": 0}
    return [head] + [{"cc": cc, "cognitive": cc + 1, "sloc": sloc, "params": params}
                     for cc, sloc in ((4, 12), (6, 14), (3, 12))]


def change(new_fns=3, lines=(1000, 1006), classes=None):
    modules = {"before": {"m": lines[0]}, "after": {"m": lines[1]}}
    return {"crossings": [0, 0], "new_fns": new_fns, "modules": {**modules, **({"classes": classes} if classes else {})}}


class Tolerances(unittest.TestCase):
    def test_the_select_item_head_carries_the_worked_example_risk(self):
        got = profile([SELECT_ITEM], ROUND3)
        self.assertEqual((round(got["cc"]), round(got["cognitive"]), round(got["size"]), got["iface"]), (264, 185, 150, 0))

    def test_the_interface_budget_is_proportional_to_the_complexity_removed(self):
        before = profile([SELECT_ITEM], ROUND3)
        narrow = verdict(before, profile(stages(1), ROUND3), change(), ROUND3)
        wide = verdict(before, profile(stages(5), ROUND3), change(), ROUND3)
        gain = -(narrow["deltas"]["cc"] + narrow["deltas"]["cognitive"]) / 2
        self.assertAlmostEqual(narrow["iface_budget"], 0.05 + 0.5 * gain, places=2)
        self.assertAlmostEqual(narrow["iface_budget"], 1.90, delta=0.1)
        self.assertTrue(narrow["pass"])
        self.assertEqual(wide["failed"], ["iface"])
        self.assertEqual(wide["iface_budget"], narrow["iface_budget"])

    def test_the_p4_shadow_column_never_gates(self):
        before = profile([{"cc": 14, "cognitive": 20, "sloc": 20, "params": 1}], CFG)
        after = profile([{"cc": 6, "cognitive": 6, "sloc": 12, "params": 1}, {"cc": 6, "cognitive": 6, "sloc": 10,
                                                                              "params": 1}], CFG)
        grown_class = {"before": {"C": [400, 40]}, "after": {"C": [410, 41]}}
        got = verdict(before, after, change(new_fns=1, lines=(1000, 1002), classes=grown_class), CFG)
        self.assertFalse(got["p4_shadow"])
        self.assertTrue(got["pass"])
        self.assertNotIn("p4_shadow", got["checks"])

    def test_module_growth_past_two_lines_per_new_function_needs_small_risk(self):
        before = profile([{"cc": 14, "cognitive": 20, "sloc": 20, "params": 1}], CFG)
        after = profile([{"cc": 6, "cognitive": 6, "sloc": 12, "params": 1}], CFG)
        self.assertEqual(verdict(before, after, change(new_fns=1, lines=(1000, 1010)), CFG)["failed"], ["module"])


class Detectors(unittest.TestCase):
    def setUp(self):
        tree, units = module_units("m.py", DETECT)
        self.found = detect(tree, units, set())
        self.classes = class_facts(tree)

    def kinds(self, qual):
        return {k: v for k, v in self.found[f"m.py:{qual}"].items() if v}

    def test_control_fixpoint_separates_flag_origins_from_forwarded_crossings(self):
        self.assertEqual(self.kinds("run")["origins"], ["verbose"])
        self.assertEqual(self.kinds("_step"), {"control": ["loud"]})
        self.assertEqual(self.kinds("quiet"), {})

    def test_stamp_unused_and_pass_through(self):
        self.assertEqual(self.kinds("use"), {"stamp": ["cfg"], "unused": ["param:other", "local:x"]})
        self.assertEqual(self.kinds("fwd"), {"pass_through": ["function"]})

    def test_common_coupling_global_module_state_temporary_field_and_bag(self):
        self.assertEqual(self.kinds("bump")["common"], ["global:COUNT"])
        self.assertIn("module:REG", self.kinds("run")["common"])
        self.assertEqual(self.kinds("K.m")["common"], ["temp:tmp"])
        self.assertEqual(self.kinds("bag")["common"], ["bag:acc"])

    def test_class_lcom4_and_temporary_fields(self):
        self.assertEqual(self.classes["K"], {"lcom4": 2, "temporary": ["tmp"], "methods": 3})

    def test_module_instability_cycles_and_sdp(self):
        trees = {rel: ast.parse(text) for rel, text in
                 {"a.py": "import b\n", "b.py": "", "c.py": "import a\nimport b\n"}.items()}
        before = structure(trees)
        self.assertEqual(before["instability"], {"a": 0.5, "b": 0.0, "c": 1.0})
        after = structure({**trees, "b.py": ast.parse("import a\nimport c\n")})
        got = violations(before, after, CFG["constraints"]["sdp_max_delta_i"])
        self.assertEqual(got["cycles"], [["a", "b", "c"]])

    def test_a_new_edge_into_a_much_less_stable_module_breaks_sdp(self):
        files = {"x.py": "import s\n", "y.py": "import s\n", "z.py": "import s\n", "s.py": "",
                 "t.py": "import l1\nimport l2\n", "l1.py": "", "l2.py": ""}
        trees = {rel: ast.parse(text) for rel, text in files.items()}
        after = structure({**trees, "s.py": ast.parse("import t\n")})
        got = violations(structure(trees), after, CFG["constraints"]["sdp_max_delta_i"])
        self.assertEqual(got, {"cycles": [], "sdp": [["s", "t", 0.417]]})


class Templates(TreeCase):
    def test_every_task_renders_and_select_item_gets_a_narrow_stage_plan(self):
        plan = plan_tree(self.tree({"p.py": PARSER}))
        self.assertTrue(all(t["template"].startswith(f"task: {t['id']}\n") for t in plan["tasks"]))
        select = next(t for t in plan["tasks"] if t["id"] == "p.py:Parser.select_item")
        self.assertIn("recipe: R3 stage extraction\n", select["template"])
        self.assertIn("(this task: +", select["template"])
        chosen = [c for c in select["candidates"] if c["id"] in select["chosen"]["edits"]]
        self.assertTrue(all(len(c["in"]) <= 2 for c in chosen))
        self.assertNotIn("score", select["template"])
        query = next(t for t in plan["tasks"] if t["id"] == "p.py:Parser.query")
        self.assertIn("recipe: none", query["template"])

    def test_an_edit_outside_the_tasks_ownership_is_a_conflict(self):
        plan = plan_tree(self.tree({"p.py": PARSER}))
        self.assertEqual(ownership_conflicts(plan), [])
        select = next(t for t in plan["tasks"] if t["id"] == "p.py:Parser.select_item")
        select["chosen"]["touches"].append("p.py:Parser.peek")
        self.assertEqual(ownership_conflicts(plan), ["p.py:Parser.select_item edits p.py:Parser.peek, which it does not own"])


if __name__ == "__main__":
    unittest.main()


class DetectorAlignment(unittest.TestCase):
    def found(self, source, qual):
        tree, units = module_units("m.py", source)
        return detect(tree, units, set())[f"m.py:{qual}"]

    def test_an_optional_parameter_tested_against_none_is_not_a_flag(self):
        source = ("def check(kind, value=None):\n    if value is not None and kind != value:\n        return False\n"
                  "    return True\n\n\ndef use():\n    return check('a', 'b')\n")
        self.assertEqual(self.found(source, "check")["control"], [])

    def test_a_local_read_only_by_a_closure_is_used(self):
        source = ("def header(path, zipped):\n    opener = open\n    if zipped:\n        opener = len\n\n"
                  "    def read():\n        return opener(path)\n    return read()\n")
        self.assertEqual(self.found(source, "header")["unused"], [])
