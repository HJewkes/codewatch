"""C-264 S2 cuts: a dropped commit's tests go, and its helpers go only once nothing names them."""

from __future__ import annotations

import unittest

from c264.strip import spans, strip, unit_text

SOURCE = '''import pytest


def ok(**kw):
    return {"id": "r", **kw}


def only_dup():
    return 1


CASES = [ok(id="")]


def test_dup():
    assert only_dup() == 1


class TestBox:
    def test_inside(self):
        assert ok()
'''


def recorded(source: str, tails: list[str]) -> dict[str, str]:
    found = spans(source)
    return {t: unit_text(source, found[t]) for t in tails}


class StripTest(unittest.TestCase):
    def test_a_helper_module_code_still_names_stays_and_one_only_cut_tests_used_goes(self):
        outcome = strip(SOURCE, recorded(SOURCE, ["ok", "only_dup", "test_dup"]))

        self.assertIn("def ok(", outcome.text)
        self.assertNotIn("def only_dup(", outcome.text)
        self.assertNotIn("def test_dup(", outcome.text)
        self.assertEqual((sorted(outcome.removed), outcome.in_use), (["only_dup", "test_dup"], ["ok"]))
        compile(outcome.text, "test_more.py", "exec")

    def test_a_helper_another_test_file_names_stays(self):
        outcome = strip(SOURCE, recorded(SOURCE, ["only_dup"]), elsewhere="from tests.test_more import only_dup\n")

        self.assertIn("def only_dup(", outcome.text)

    def test_a_test_class_left_without_tests_goes(self):
        outcome = strip(SOURCE, recorded(SOURCE, ["TestBox::test_inside"]))

        self.assertNotIn("class TestBox", outcome.text)
        self.assertIn("def test_dup(", outcome.text)


if __name__ == "__main__":
    unittest.main()
