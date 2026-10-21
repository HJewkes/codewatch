import fnmatch
import json
import re
import unittest

from tests.ar_fixtures import BENCH

AR = BENCH / "autoresearch"
REPO = BENCH.parent.parent
BOUNDS = json.loads((AR / "bounds.json").read_text())
TARGET = json.loads((AR / "target.json").read_text())
CONFIG = json.loads((BENCH / "planner" / "config.json").read_text())


def expand(pattern: str) -> list[str]:
    """`a/{x,y}.py` -> [`a/x.py`, `a/y.py`]; one brace group at most, as bounds.json writes them."""
    match = re.search(r"\{([^}]*)\}", pattern)
    return [pattern[:match.start()] + alt + pattern[match.end():] for alt in match.group(1).split(",")] if match else [pattern]


def lookup(cfg: dict, dotted: str):
    for key in dotted.split("."):
        cfg = cfg[key]
    return cfg


class BoundsTests(unittest.TestCase):
    def class_paths(self) -> list[str]:
        return [p for c in BOUNDS["classes"].values() for pattern in c["paths"] for p in expand(pattern)]

    def test_every_class_path_exists_and_none_is_frozen(self):
        for path in self.class_paths():
            self.assertTrue((REPO / path).is_file(), path)
            self.assertFalse(any(fnmatch.fnmatch(path, glob.replace("**", "*")) for glob in TARGET["frozen"]), path)

    def test_the_current_config_sits_inside_every_param_range(self):
        for name, (low, high) in BOUNDS["classes"]["config-param"]["params"].items():
            self.assertTrue(low <= lookup(CONFIG, name) <= high, name)

    def test_every_integer_valued_param_is_marked_integer_with_integer_bounds(self):
        config_param = BOUNDS["classes"]["config-param"]
        integers = {name for name in config_param["params"] if type(lookup(CONFIG, name)) is int}
        integers.discard("floor_gain_per_new_function")  # compared as a ratio; a real value is valid
        self.assertEqual(set(config_param["integerParams"]), integers)
        for name in integers:
            self.assertTrue(all(type(v) is int for v in config_param["params"][name]), name)

    def test_no_diff_size_cap(self):
        self.assertEqual(BOUNDS["diff"], {"oneClassPerIdea": True})


class TargetTests(unittest.TestCase):
    """The parts of ar-target/v1 the engine's TargetSchema reads (titan-platform #2074)."""

    def test_metric_block_is_the_v2_keep_rule(self):
        metric = TARGET["metric"]
        self.assertEqual(set(metric), {"primary", "guards", "zeroTolerance", "allGate", "noOp", "noise"})
        self.assertEqual(metric["primary"], {"name": "cc_total_delta_pct", "direction": "min"})
        self.assertEqual((metric["guards"], metric["zeroTolerance"], metric["allGate"], metric["noOp"]),
                         ({"single_caller_delta": 1}, ["hidden_regressions"], True, "accepted_tasks"))
        self.assertEqual(set(metric["noise"]), {"bandSigmas", "lockAfterPairs", "minPairs", "defaultBand"})

    def test_phases_and_micro_rungs_fit_the_schema(self):
        for phase in TARGET["phases"]:
            self.assertTrue(phase["train"] and phase["baselineRuns"] >= 2 and phase["baselineRuns"] % 2 == 0, phase["id"])
            self.assertTrue(phase["stop"]["ideasEvaluated"] > 0 and phase["stop"]["roundsWithoutGain"] > 0, phase["id"])
            self.assertTrue(set(phase["train"]) <= set(TARGET["caseSets"]), phase["id"])
        self.assertEqual(set(TARGET["microRung"]), set(BOUNDS["classes"]))
        self.assertTrue(set(TARGET["microRung"].values()) <= set(TARGET["rungs"]))

    def test_every_rung_command_is_an_adapter_script(self):
        for name, rung in TARGET["rungs"].items():
            self.assertTrue((REPO / rung["cmd"][1]).is_file(), name)


if __name__ == "__main__":
    unittest.main()
