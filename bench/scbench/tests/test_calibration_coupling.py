import tempfile
import textwrap
import unittest
from pathlib import Path

from calibration import curves
from calibration.measure import measure_module, measure_project

FLAGS = textwrap.dedent('''
    REGISTRY = []
    COUNT = 0

    def render(text, upper):
        if upper:
            return text.upper()
        return text

    def show(text, upper=False):
        return render(text, upper) + "!"

    def title(cfg):
        return cfg.name.strip() + cfg.name

    def note(x):
        global COUNT
        COUNT = x
        REGISTRY.append(x)

    class Split:
        def __init__(self):
            self.a = 1
            self.b = 2

        def left(self):
            return self.a

        def right(self):
            self.cache = self.b
            return self.cache
''')


def unit(module, name):
    return next(u for u in module["units"] if u["key"] == f"pkg/flags.py:{name}")


class UnitCoupling(unittest.TestCase):
    def test_a_flag_forwarded_from_a_bool_default_is_an_origin_upstream_and_a_crossing_downstream(self):
        module = measure_module("pkg/flags.py", FLAGS)
        self.assertEqual((unit(module, "show")["control"], unit(module, "show")["control_origin"]), (1, 1))
        self.assertEqual((unit(module, "render")["control"], unit(module, "render")["control_origin"]), (1, 0))

    def test_a_parameter_read_through_one_attribute_is_stamp_coupled(self):
        module = measure_module("pkg/flags.py", FLAGS)
        self.assertEqual(unit(module, "title")["stamp"], 1)
        self.assertEqual(unit(module, "render")["stamp"], 0)

    def test_global_stores_module_mutable_writes_and_temporary_fields_count_as_common_coupling(self):
        module = measure_module("pkg/flags.py", FLAGS)
        self.assertEqual(unit(module, "note")["common"], 2)
        self.assertEqual(unit(module, "Split.right")["common"], 1)
        self.assertEqual(unit(module, "Split.left")["common"], 0)


class ClassCohesion(unittest.TestCase):
    def test_methods_sharing_no_field_split_the_class_and_late_fields_are_temporary(self):
        split = measure_module("pkg/flags.py", FLAGS)["classes"][0]
        self.assertEqual((split["lcom4"], split["temp_fields"]), (2, 1))


class ModuleCycles(unittest.TestCase):
    def test_each_module_in_an_import_cycle_carries_the_cycle_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, text in {"pkg/__init__.py": "", "pkg/a.py": "from pkg import b\n",
                              "pkg/b.py": "from pkg import a\n", "pkg/c.py": "from pkg import a\n"}.items():
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(text)
            measured = measure_project(root)
        cycle = {m["path"]: m["cycle"] for m in measured["modules"]}
        self.assertEqual(cycle, {"pkg/__init__.py": 0, "pkg/a.py": 2, "pkg/b.py": 2, "pkg/c.py": 0})


def coupled_system(rows):
    base = {"cc": 1, "cc_scb": 1, "cog": 0, "cog_scb": 0, "in": 1}
    units = [{**base, "control": c, "control_origin": o, "stamp": s, "common": m, "sloc": n} for c, o, s, m, n in rows]
    module = {"fan_in": 0, "fan_out": 0, "instability": 0.0}
    return {"units": units, "classes": [{"methods": 2, "lcom4": 3, "temp_fields": 1, "sloc": 10}],
            "modules": [{**module, "cycle": 0, "sloc": 60}, {**module, "cycle": 2, "sloc": 40}]}


class CouplingCurves(unittest.TestCase):
    def setUp(self):
        self.derived = curves.derive([coupled_system([(0, 0, 0, 0, 70), (1, 1, 2, 3, 30)])])

    def test_new_families_are_derived_per_entity_kind(self):
        self.assertEqual({f: sorted(self.derived[f]) for f in ("control", "stamp", "common", "cohesion", "cycles")},
                         {"control": ["control", "control_origin"], "stamp": ["stamp"], "common": ["common"],
                          "cohesion": ["lcom4", "temp_fields"], "cycles": ["cycle"]})
        self.assertEqual(self.derived["cohesion"]["lcom4"]["entity"], "classes")
        self.assertEqual(self.derived["cycles"]["cycle"]["entity"], "modules")

    def test_unit_counts_are_banded_by_share_of_code(self):
        self.assertEqual([self.derived["common"]["common"][q] for q in ("p70", "p80", "p90")], [0, 3, 3])
        self.assertEqual([self.derived["cycles"]["cycle"][q] for q in ("p70", "p80", "p90")], [2, 2, 2])

    def test_scoring_reports_band_shares_for_the_new_families(self):
        system = coupled_system([(0, 0, 0, 0, 50), (4, 4, 4, 9, 50)])
        scored = curves.score(system, self.derived)
        self.assertEqual(scored["common"]["common"], {"low": 0.5, "moderate": 0.0, "high": 0.0, "very_high": 0.5})


if __name__ == "__main__":
    unittest.main()
