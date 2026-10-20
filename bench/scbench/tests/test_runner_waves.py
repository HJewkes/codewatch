"""The S6 cleanup runner's wave machinery (C-248): the function-level splice, the scheduler and the
integration gate's reverse-order revert. Each test names the mutation it catches.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from runner.integrate import integrate
from runner.schedule import LANES, next_wave, shared_wave
from runner.splice import segments, splice
from tests.runner_fixtures import MESSAGE, FakeSteps, ladder, module, set_function, table, write_app

NAMES = ["calc_a", "calc_b", "calc_c"]


def tmp() -> Path:
    return Path(tempfile.mkdtemp())


class Segments(unittest.TestCase):
    def test_segments_join_back_to_the_module_exactly(self):
        # mutation: a segment that drops the comment or blank lines above a def
        text = "import re\n\n\n# about a\ndef a():\n    pass\n\n\nclass K:\n    x = 1\n\n    def m(self):\n        pass\n"
        self.assertEqual("".join(t for _, t in segments(text)), text)
        self.assertEqual([k for k, _ in segments(text)], ["|import re", "a", "class K", "K.|x = 1", "K.m"])


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
        self.assertLess(text.index("def f2_helper"), text.index("def f3("))
        self.assertIn(table("f5"), text)

    def test_two_lanes_changing_one_function_differently_drop_the_later_lane(self):
        # mutation: the later lane's text silently overwriting the earlier one
        other = {"app.py": module(self.names, {"f1": "error: other "}).encode()}
        out = splice(self.base, {"t1": self.lane(["f1"]), "t2": other})
        self.assertEqual((out["spliced"], out["conflicts"]), (["t1"], {"t2": ["app.py"]}))


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


class IntegrationRevert(unittest.TestCase):
    def test_the_failing_lane_alone_is_reverted(self):
        # mutation: peeling from the end, which also reverts the innocent last lane
        root = tmp()
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


if __name__ == "__main__":
    unittest.main()
