"""C-280 S1: the outcome key's buckets and the recording plugin's caller-frame rule."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

from c280.keys import verdict
from remediation.outcomes import (
    Recorder,
    boundary,
    message_class,
    outcome,
    read_keys,
    shape,
    string_constants,
)

SOURCE = '''
def f(x):
    return g(x)


def g(x):
    if x < 0:
        raise ValueError("'fix' must be an object")
    return {"fix": 1}


class Box:
    def put(self, a, b):
        return a
'''


def load(root: Path):
    path = root / "entry_mod.py"
    path.write_text(SOURCE)
    spec = importlib.util.spec_from_file_location("entry_mod", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return path, module


class MessageClassTest(unittest.TestCase):
    LITERALS = frozenset({"fix", "must be an object"})

    def test_message_class_keeps_source_literals_and_masks_other_quotes(self) -> None:
        fix = message_class("'fix' must be an object", self.LITERALS)
        rule = message_class("'rule' must be an object", self.LITERALS)
        self.assertNotEqual(fix, rule)
        self.assertEqual(message_class("unknown op 'zz'", self.LITERALS), message_class("unknown op 'qq'", self.LITERALS))

    def test_numbers_and_addresses_do_not_split_a_message_class(self) -> None:
        self.assertEqual(message_class("line 3", ()), message_class("line 14", ()))
        self.assertEqual(message_class("<W at 0x7f12ab>", ()), message_class("<W at 0x9c00>", ()))

    def test_message_class_keeps_eight_tokens(self) -> None:
        self.assertEqual(len(message_class("a b c d e f g h i j", ()).split()), 8)


class ShapeTest(unittest.TestCase):
    def test_float_returns_bucket_by_sign_not_value(self) -> None:
        key = lambda v: outcome(v, (), {})
        self.assertEqual(key(0.1), key(2.5))
        self.assertEqual(len({key(-1.0), key(0.0), key(float("nan")), key(0.5)}), 4)

    def test_returning_an_argument_is_a_distinct_alias_class(self) -> None:
        d = {"a": 1}
        same, equal, new = outcome(d, (d,), {}), outcome({"a": 1}, (d,), {}), outcome({"b": 2}, (d,), {})
        self.assertEqual(len({same, equal, new}), 3)

    def test_boundary_relation_of_two_scalar_args(self) -> None:
        self.assertEqual(boundary((0, 0)), "eq")
        self.assertEqual(boundary((0, 1)), "lt")
        self.assertEqual(boundary((1, 0)), "gt")
        self.assertEqual(boundary((0, "a")), "-")

    def test_tuple_positions_and_container_sizes_are_distinguished(self) -> None:
        self.assertNotEqual(shape((3, None)), shape((3, 4)))
        self.assertEqual(len({shape([]), shape([1]), shape([1, 2])}), 3)


class RecorderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.addCleanup(self.dir.cleanup)
        self.entry, self.module = load(self.root)
        self.recorder = Recorder(self.entry, Path(__file__).parent, self.root / "out.jsonl")
        self.recorder.wrap_module(self.module)

    def callees(self) -> set[str]:
        return {key.split("|")[0] for key in self.recorder.current}

    def test_only_calls_from_a_test_frame_are_recorded(self) -> None:
        self.recorder.begin()
        self.module.f(1)
        self.assertEqual(self.callees(), {"f"})

    def test_a_raise_and_a_method_are_keyed_by_qualified_callee(self) -> None:
        self.recorder.begin()
        with self.assertRaises(ValueError):
            self.module.g(-1)
        self.module.Box().put(1, 2)
        keys = self.recorder.current
        self.assertIn("g|raise:ValueError:'fix' must be an object|-", keys)
        self.assertIn("Box.put|return:pos:equal|lt", keys)

    def test_events_round_trip_through_the_jsonl(self) -> None:
        self.recorder.begin()
        self.module.f(1)
        self.recorder.end("t.py::a")
        self.assertEqual(read_keys(self.root / "out.jsonl"), {"t.py::a": frozenset({"f|return:dict:1:pos:new|-"})})

    def test_string_constants_come_from_the_entry_ast(self) -> None:
        self.assertIn("fix", string_constants(SOURCE))


class VerdictTest(unittest.TestCase):
    def test_two_units_with_the_same_new_key_admit_the_first_by_node_id(self) -> None:
        units = [{"bench": "b", "nodeids": ["t::z"]}, {"bench": "b", "nodeids": ["t::a"]},
                 {"bench": "b", "nodeids": ["t::k"]}, {"bench": "c", "nodeids": ["t::m"]}]
        none = {"t::z": frozenset({"x"}), "t::a": frozenset({"x"}), "t::k": frozenset({"old"}),
                "t::m": frozenset({"x"})}
        rows = {r["nodeids"][0]: r for r in verdict(units, {"t::keep": frozenset({"old"})}, none)}
        self.assertEqual({n: r["admit_greedy"] for n, r in rows.items()},
                         {"t::a": True, "t::z": False, "t::k": False, "t::m": True})
        self.assertTrue(rows["t::z"]["admit_any_new_key"])
        self.assertFalse(rows["t::k"]["admit_any_new_key"])


if __name__ == "__main__":
    unittest.main()
