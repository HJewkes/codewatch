import tempfile
import unittest
from pathlib import Path

from remediation.admission import Verdict, retry_prompt
from remediation.floor import BROAD_RAISE, MOCK_AND_BROAD, MOCK_ONLY, NO_ASSERTION, floor


def tree(files: dict[str, str]) -> Path:
    root = Path(tempfile.mkdtemp())
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)
    return root


def verdicts(source: str, *extra: tuple[str, str], ids: tuple[str, ...] = ("tests/test_a.py::test_x",)):
    return floor(tree({"tests/test_a.py": source, **dict(extra)}), ids)


class FloorTests(unittest.TestCase):
    def test_assertion_free_test_fails_the_floor_even_with_new_reach(self):
        got = verdicts("from app import run\n\n\ndef test_x():\n    run(3)\n")
        self.assertEqual(got["tests/test_a.py::test_x"], NO_ASSERTION)

    def test_helper_with_strong_assert_passes_the_floor(self):
        helpers = ("tests/helpers.py", "def check(r):\n    assert r == 3\n")
        source = "from tests.helpers import check\n\n\ndef test_x():\n    check(1 + 2)\n"
        self.assertIsNone(verdicts(source, helpers)["tests/test_a.py::test_x"])

    def test_mock_only_oracles_fail_the_floor(self):
        only = "def test_x(m):\n    m.go()\n    m.go.assert_called_once_with(1)\n"
        both = only + "    assert m.go() == 3\n"
        self.assertEqual(verdicts(only)["tests/test_a.py::test_x"], MOCK_ONLY)
        self.assertIsNone(verdicts(both)["tests/test_a.py::test_x"])

    def test_call_count_comparison_counts_as_mock_only(self):
        got = verdicts("def test_x(m):\n    assert m.go.call_count == 2\n")
        self.assertEqual(got["tests/test_a.py::test_x"], MOCK_ONLY)

    def test_bare_pytest_raises_exception_fails_but_typed_raises_passes(self):
        broad = "import pytest\n\n\ndef test_x():\n    with pytest.raises(Exception):\n        int('x')\n"
        typed = broad.replace("(Exception)", "(ValueError)")
        matched = broad.replace("(Exception)", "(Exception, match='x')")
        self.assertEqual(verdicts(broad)["tests/test_a.py::test_x"], BROAD_RAISE)
        self.assertIsNone(verdicts(typed)["tests/test_a.py::test_x"])
        self.assertIsNone(verdicts(matched)["tests/test_a.py::test_x"])

    def test_weak_only_test_fails_and_class_methods_and_cases_resolve(self):
        source = "class TestBox:\n    def test_x(self):\n        assert 1 is not None\n"
        got = verdicts(source, ids=("tests/test_a.py::TestBox::test_x[1]",))
        self.assertIsNotNone(got["tests/test_a.py::TestBox::test_x[1]"])


class FloorKindsTests(unittest.TestCase):
    def test_a_mix_of_mock_and_broad_raise_gets_its_own_reason(self):
        source = ("import pytest\n\n\ndef test_x(m):\n    m.go.assert_called_once()\n"
                  "    with pytest.raises(Exception):\n        m.go()\n")
        self.assertEqual(verdicts(source)["tests/test_a.py::test_x"], MOCK_AND_BROAD)

    def test_async_mock_assertions_are_mock_only(self):
        for call in ("assert_awaited_once()", "assert_not_awaited()", "assert_awaited_with(1)"):
            got = verdicts(f"def test_x(m):\n    m.go.{call}\n")
            self.assertEqual(got["tests/test_a.py::test_x"], MOCK_ONLY, call)

    def test_tuple_and_unittest_broad_raises_fail(self):
        tup = "import pytest\n\n\ndef test_x():\n    with pytest.raises((Exception,)):\n        int('x')\n"
        unit = "class TestA:\n    def test_x(self):\n        with self.assertRaises(Exception):\n            int('x')\n"
        self.assertEqual(verdicts(tup)["tests/test_a.py::test_x"], BROAD_RAISE)
        self.assertEqual(verdicts(unit, ids=("tests/test_a.py::TestA::test_x",))["tests/test_a.py::TestA::test_x"],
                         BROAD_RAISE)


class AdmissionFloorTests(unittest.TestCase):
    def test_retry_prompt_names_the_reason_per_test(self):
        text = retry_prompt(["t::a", "t::b"], {"t::a": NO_ASSERTION})
        self.assertIn(f"t::a: {NO_ASSERTION}", text)
        self.assertIn("t::b", text)

    def test_retry_prompt_without_reasons_is_unchanged(self):
        self.assertEqual(retry_prompt(["t::a"]), retry_prompt(["t::a"], {}))
        self.assertNotIn("lacks a real check", retry_prompt(["t::a"]))

    def test_verdict_reasons_default_empty(self):
        self.assertEqual(dict(Verdict().reasons), {})


class FakeGit:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace

    def files_in(self, sha):
        return ["tests/test_a.py"]

    def run(self, *args):
        from remediation.git import GitError
        raise GitError("no parent")


class CountingCoverage:
    tests_dir = "tests"

    def __init__(self) -> None:
        self.selections: list[list[str]] = []

    def reach(self, selection, timeout):
        self.selections.append(list(selection))
        return frozenset({"app.py:1"}) if "tests/test_a.py::test_ok" in selection else frozenset()


class SharedLineCoverage(CountingCoverage):
    """Both tests reach app.py:1; the base run reaches it only if it does not deselect test_weak."""

    def reach(self, selection, timeout):
        self.selections.append(list(selection))
        if selection and selection[0] == "tests":
            deselected = {selection[i + 1] for i, a in enumerate(selection) if a == "--deselect"}
            return frozenset() if "tests/test_a.py::test_weak" in deselected else frozenset({"app.py:1"})
        return frozenset({"app.py:1"})


class AdmissionFloorRunTests(unittest.TestCase):
    SOURCE = "def test_weak():\n    pass\n\n\ndef test_ok():\n    assert 1 + 1 == 2\n"

    def admit(self, floor_on: bool):
        from remediation.admission import Admission
        coverage = CountingCoverage()
        gate = Admission(FakeGit(tree({"tests/test_a.py": self.SOURCE})), coverage, floor=floor_on)
        return gate("sha", None), coverage

    def test_floor_rejects_a_failing_test_before_any_coverage_run(self):
        verdict, coverage = self.admit(True)
        self.assertEqual(verdict.reasons, {"tests/test_a.py::test_weak": NO_ASSERTION})
        self.assertIn("tests/test_a.py::test_weak", verdict.rejected)
        self.assertNotIn(["tests/test_a.py::test_weak"], coverage.selections)

    def test_a_floor_rejected_test_does_not_count_toward_the_base_coverage(self):
        from remediation.admission import Admission
        coverage = SharedLineCoverage()
        gate = Admission(FakeGit(tree({"tests/test_a.py": self.SOURCE})), coverage, floor=True)
        verdict = gate("sha", None)
        self.assertEqual(verdict.admitted, ("tests/test_a.py::test_ok",))
        base = coverage.selections[0]
        self.assertIn("tests/test_a.py::test_weak", base)

    def test_floor_is_off_by_default(self):
        verdict, coverage = self.admit(False)
        self.assertEqual(dict(verdict.reasons), {})
        self.assertIn(["tests/test_a.py::test_weak"], coverage.selections)
