import ast
import contextlib
import importlib.util
import io
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent / "c239" / "harness"


def load(name):
    spec = importlib.util.spec_from_file_location(name, HARNESS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


HAVE_YAML = importlib.util.find_spec("yaml") is not None
dilution, report = load("dilution"), load("cleanup_report")
table = load("table_c246") if HAVE_YAML else None


def ladder(name, arms, extra=""):
    """A function of CC 1 + arms and SLOC 2 + 2 * arms (+ extra lines), docstring not counted."""
    body = "".join(f"    if x == {i}:\n        return {i}\n" for i in range(arms))
    return f'def {name}(x):\n    """Docstring."""\n{extra}{body}    return x\n'


def cc(source):
    return dilution.cyclomatic(ast.parse(source).body[0])


def write(root, files):
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    return root


UNTOUCHED = ladder("steady", 11) + "\n\n" + "def tiny(x):\n    return x\n"
NESTED = ("def walk(items):\n    while items:\n        for x in items:\n            if x:\n                pass\n"
          "            elif x is None:\n                pass\n    return items\n")
DEFENSIVE = "def guard(x):\n    try:\n        return isinstance(x, int) or x is not None\n    except ValueError:\n        return None\n"
BEFORE = {"pkg/steady.py": UNTOUCHED, "pkg/core.py": ladder("big", 13) + "\n\n" + NESTED,
          "tests/test_core.py": ladder("test_huge", 30)}
AFTER = {"pkg/steady.py": UNTOUCHED, "pkg/core.py": ladder("big", 7) + "\n\n" + ladder("rest", 6) + "\n\n" + DEFENSIVE,
         "tests/test_core.py": ladder("test_huge", 30)}


class CyclomaticMatchesScbCheckRules(unittest.TestCase):
    def test_each_branch_kind_adds_one(self):
        self.assertEqual(cc("def f(x):\n    if x:\n        pass\n    elif x:\n        pass\n    else:\n        pass\n"), 3)
        self.assertEqual(cc("def f(x):\n    for a in x:\n        pass\n    while x:\n        pass\n"), 3)
        self.assertEqual(cc("def f(x):\n    try:\n        pass\n    except A:\n        pass\n    except B:\n        pass\n"), 3)
        self.assertEqual(cc("def f(x):\n    assert x\n    return 1 if x else 2\n"), 3)

    def test_boolean_operators_count_per_operator(self):
        self.assertEqual(cc("def f(a, b, c, d):\n    return a and b and c or d\n"), 4)

    def test_comprehension_counts_once_plus_each_if_not_per_for(self):
        self.assertEqual(cc("def f(x):\n    return [a for b in x for a in b if a if b]\n"), 4)
        self.assertEqual(cc("def f(x):\n    return {a: 1 for a in x}, {a for a in x}, sum(a for a in x)\n"), 4)

    def test_nested_function_counts_in_its_parent(self):
        self.assertEqual(cc("def f(x):\n    def g(y):\n        if y:\n            pass\n    return g\n"), 2)


class ScopeMatchesScbCheckWalk(unittest.TestCase):
    def test_docstrings_and_comments_are_not_sloc_and_scope_skips_module_level_if(self):
        text = ('"""Mod."""\nimport typing\n\nif typing.TYPE_CHECKING:\n    def hidden():\n        pass\n\n\n'
                'class C:\n    def m(self):\n        """Doc\n        more."""\n        # note\n        x = 1\n'
                '        def inner():\n            return x\n        return inner\n')
        module = dilution.parse_module(text, "m.py")
        self.assertEqual([(f.key, f.sloc) for f in module.functions], [("m.py:C.m", 5), ("m.py:C.m.inner", 2)])

    def test_tests_dir_and_tool_dirs_are_left_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = write(Path(tmp), {"a.py": "x = 1\n", "tests/t.py": "", "pkg/tests/u.py": "", ".venv/v.py": "",
                                     ".codewatch/w.py": ""})
            rel = [p.relative_to(root).as_posix() for p in dilution.source_files(root)]
        self.assertEqual(rel, ["a.py", "pkg/tests/u.py"])


class CleanupReportLines(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.before = write(Path(tmp.name) / "before", BEFORE)
        self.after = write(Path(tmp.name) / "after", AFTER)
        self.numbers = report.numbers_for(self.before, self.after)
        self.lines = report.render(self.numbers).splitlines()

    def test_tree_line_shows_mass_count_max_and_total_before_and_after(self):
        steady, big = 12 * math.sqrt(24), 14 * math.sqrt(28)
        self.assertEqual(self.numbers["tree"][0], {"mass": round(steady + big, 1), "count": 2, "max": 14, "total": 32,
                                                   "functions": 4, "erosion": self.numbers["tree"][0]["erosion"]})
        self.assertEqual(self.lines[1], f"[tree] high-CC mass {steady + big:.1f} -> {steady:.1f} (-56%); "
                                        "CC>10 count 2 -> 1 (-50%); max CC 14 -> 12 (-14%); total CC 32 -> 31 (-3%)")

    def test_touched_line_covers_only_added_edited_and_removed_functions(self):
        self.assertEqual(self.numbers["touched_functions"],
                         ["pkg/core.py:big", "pkg/core.py:guard", "pkg/core.py:rest", "pkg/core.py:walk"])
        self.assertEqual(self.lines[3], f"[legacy touched, 4 functions] high-CC mass {14 * math.sqrt(28):.1f} -> 0.0 (-100%); "
                                        "CC>10 count 1 -> 0 (-100%); max CC 14 -> 8 (-43%); total CC 19 -> 18 (-5%)")

    def test_erosion_is_labelled_legacy_and_is_high_mass_over_all_mass(self):
        steady, big = 12 * math.sqrt(24), 14 * math.sqrt(28)
        everything = steady + big + 1 * math.sqrt(2) + 5 * math.sqrt(8)
        self.assertAlmostEqual(self.numbers["tree"][0]["erosion"], (steady + big) / everything)
        self.assertTrue(self.lines[4].startswith("[legacy] erosion (reported for comparability): "))

    def test_nesting_and_defensive_density_are_report_lines_only(self):
        (b, a) = self.numbers["lines"]
        self.assertEqual((b["nesting_max"], a["nesting_max"]), (3, 1))
        self.assertEqual((b["defensive_per_100"], a["defensive_per_100"]),
                         (round(100 * 1 / b["sloc"], 2), round(100 * 3 / a["sloc"], 2)))
        self.assertEqual(self.lines[5], f"[report] max nesting depth 3 -> 1; defensive checks per 100 SLOC "
                                        f"{b['defensive_per_100']:.2f} -> {a['defensive_per_100']:.2f}. "
                                        "Report lines, not task types.")

    def test_report_has_six_lines_and_no_dropped_signals(self):
        text = "\n".join(self.lines).lower()
        self.assertEqual(len(self.lines), 6)
        for dropped in ("halstead", "maintainability", " mi ", "single-caller"):
            self.assertNotIn(dropped, text)

    def test_main_writes_the_numbers_as_json(self):
        out = self.before.parent / "cleanup.json"
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            report.main([str(self.before), str(self.after), "--json", str(out)])
        self.assertEqual(json.loads(out.read_text())["touched_functions"], self.numbers["touched_functions"])
        self.assertEqual(printed.getvalue().splitlines(), self.lines)


@unittest.skipUnless(HAVE_YAML, "table_c246 needs PyYAML")
class TableShowsDilutionNotSingleCaller(unittest.TestCase):
    def run_row(self, dil):
        return {"key": "p", "n": 2, "tier": "E", "hidden": (1, 1, 2), "ex": (0.5, 0.4), "vx": (0.2, 0.2),
                "cc": (10, 9), "net": -3, "add": 1, "rem": 4, "dil": dil, "ts": (0.5, 0.5),
                "gates": {"hidden": True, "growth": True, "helpers": True, "tests": True, "diff": True}, "diffs": 0,
                "usd": 1.0}

    def test_row_shows_tree_mass_count_and_max_or_a_dash_without_cleanup_json(self):
        dil = [{"mass": 100.4, "count": 3, "max": 20}, {"mass": 50.0, "count": 1, "max": 12}]
        self.assertIn("| 100 · 3 · 20 → 50 · 1 · 12 |", table.row(self.run_row(dil)))
        self.assertIn("| – |", table.row(self.run_row(None)))

    def test_summary_reports_mass_and_legacy_erosion_and_no_single_caller(self):
        dil = [{"mass": 100.0, "count": 3, "max": 20}, {"mass": 50.0, "count": 1, "max": 12}]
        lines = table.summary([self.run_row(dil), self.run_row(None)])
        self.assertIn("- high-CC mass Δ% (tree): n<2; fell in 1/1 with cleanup.json", lines)
        self.assertTrue(any(l.startswith("- eros-xT Δ (legacy, reported for comparability):") for l in lines))
        self.assertFalse(any("single-caller" in l for l in lines))


if __name__ == "__main__":
    sys.exit(unittest.main())
