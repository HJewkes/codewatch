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

    def test_an_autouse_fixture_and_a_hook_stay_though_nothing_names_them(self):
        source = ("import pytest\n\n\n@pytest.fixture(autouse=True)\ndef env():\n    yield\n\n\n"
                  "def pytest_configure(config):\n    pass\n\n\ndef test_x():\n    assert True\n")

        outcome = strip(source, recorded(source, ["env", "pytest_configure", "test_x"]))

        self.assertIn("def env(", outcome.text)
        self.assertIn("def pytest_configure(", outcome.text)

    def test_a_recorded_import_goes_only_once_nothing_names_it(self):
        source = "from __future__ import annotations\nimport os\nimport re\n\n\ndef test_x():\n    assert re\n"
        imports = frozenset({"import os", "import re", "from __future__ import annotations"})

        outcome = strip(source, {}, imports=imports)

        self.assertEqual(outcome.text, "from __future__ import annotations\nimport re\n\n\ndef test_x():\n    assert re\n")


if __name__ == "__main__":
    unittest.main()
