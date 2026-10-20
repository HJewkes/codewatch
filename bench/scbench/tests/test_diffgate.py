import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from diffgate.compare import LeakageError, verdict
from diffgate.mutate import generate, variants
from diffgate.replay import load_cases, replay

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "diffgate" / "recorder"))
import diffgate_recorder  # noqa: E402

PROGRAM = '''import json, sys
rules = json.load(open(sys.argv[1]))
if not isinstance(rules, list):
    print({message!r}, file=sys.stderr)
    sys.exit(2)
for rule in rules:
    print(rule.get("id"))
'''
BASE_MESSAGE = "error: rules must be an array"


def write_program(root, message=BASE_MESSAGE):
    root.mkdir(parents=True, exist_ok=True)
    (root / "prog.py").write_text(PROGRAM.format(message=message))
    return root


def outcome(rc=0, stdout="", stderr="", files=None):
    return {"rc": rc, "stdout": stdout, "stderr": stderr, "files": files or {}}


class DiffGateTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.tmp = Path(self._tmp.name)
        self.cases = self.tmp / "cases"
        self.cases.mkdir()
        self.base = write_program(self.tmp / "base")

    def tearDown(self):
        self._tmp.cleanup()

    def record_call(self, rules):
        test_tmp = self.tmp / "pytest-of-u" / "pytest-0" / "test_x0"
        test_tmp.mkdir(parents=True, exist_ok=True)
        (test_tmp / "rules.json").write_text(json.dumps(rules))
        env = {"DIFFGATE_CASES": str(self.cases), "DIFFGATE_ROOT": str(self.base),
               "PYTEST_CURRENT_TEST": "tests/test_a.py::test_rules (call)"}
        argv = [sys.executable, str(self.base / "prog.py"), str(test_tmp / "rules.json")]
        with mock.patch.dict(os.environ, env):
            diffgate_recorder.record(argv, {"cwd": str(self.base)})

    def gate(self, head_message, generate_inputs=True):
        self.record_call([{"id": "r1"}])
        if generate_inputs:
            for name in list(load_cases(self.cases)):
                generate(self.cases / name, self.cases)
        head = write_program(self.tmp / "head", head_message)
        runs = {side: replay(self.cases, root, self.tmp / "scratch" / side, sys.executable, workers=2)
                for side, root in (("base", self.base), ("base_again", self.base), ("head", head))}
        return verdict(load_cases(self.cases), runs)

    def test_recorded_call_is_rewritten_to_placeholders(self):
        self.record_call([{"id": "r1"}])
        (case,) = load_cases(self.cases).values()
        self.assertEqual(case["argv"], ["{PY}", "{ROOT}/prog.py", "{CASE}/p0/rules.json"])
        self.assertEqual(case["nodeids"], ["tests/test_a.py::test_rules"])

    def test_identical_calls_from_two_tests_share_one_case(self):
        self.record_call([{"id": "r1"}])
        self.record_call([{"id": "r1"}])
        self.assertEqual(len(load_cases(self.cases)), 1)

    def test_reworded_error_message_fails_through_generated_inputs(self):
        result = self.gate("error: rules file must be a JSON array")
        self.assertFalse(result["pass"])
        self.assertTrue(result["pass_tests_tier"])
        self.assertGreater(result["tiers"]["generated"]["differs"], 0)

    def test_refactor_with_the_same_behaviour_passes(self):
        result = self.gate(BASE_MESSAGE)
        self.assertTrue(result["pass"])
        self.assertGreater(result["tiers"]["generated"]["same"], 0)

    def test_variants_cover_delete_null_and_type_swap(self):
        labels = [label for label, _ in variants([{"id": "r1"}])]
        self.assertIn("$[0]['id']:delete", labels)
        self.assertIn("$[0]['id']:null", labels)
        self.assertIn("$:type", labels)

    def verdict_of(self, base, again, head, case=None, **kwargs):
        cases = {"c": case or {"source": "tests", "nodeids": ["t::a"]}}
        return verdict(cases, {"base": {"c": base}, "base_again": {"c": again}, "head": {"c": head}}, **kwargs)

    def test_traceback_compares_by_its_final_line(self):
        tb = "Traceback (most recent call last):\n  File \"p.py\", line {}, in f\nKeyError: 'x'\n"
        result = self.verdict_of(outcome(1, stderr=tb.format(3)), outcome(1, stderr=tb.format(3)),
                                 outcome(1, stderr=tb.format(9)))
        self.assertTrue(result["pass"])

    def test_case_that_differs_between_base_runs_is_excluded_as_nondeterministic(self):
        result = self.verdict_of(outcome(stdout="t=1"), outcome(stdout="t=2"), outcome(stdout="t=3"))
        self.assertTrue(result["pass"])
        self.assertEqual(result["tiers"]["tests"]["nondeterministic"], 1)

    def test_eval_mode_excuses_a_difference_whose_hidden_test_was_fixed(self):
        regrade = {"before": {"hidden": {"failed": ["t::a"]}}, "after": {"hidden": {"failed": []}}}
        hidden = {"source": "hidden", "nodeids": ["t::a"]}
        result = self.verdict_of(outcome(1), outcome(1), outcome(0), hidden, regrade=regrade, mode="eval")
        self.assertTrue(result["pass"])
        self.assertEqual(result["differences"][0]["excuse"], "S1 hidden test fixed")

    def test_inloop_mode_refuses_hidden_test_results(self):
        regrade = {"before": {"hidden": {"failed": ["t::a"]}}, "after": {"hidden": {"failed": []}}}
        with self.assertRaises(LeakageError):
            self.verdict_of(outcome(1), outcome(1), outcome(0), regrade=regrade)

    def test_inloop_mode_refuses_cases_derived_from_hidden_tests(self):
        for case in ({"source": "hidden", "nodeids": []}, {"source": "generated", "parent_source": "hidden"}):
            with self.subTest(case=case), self.assertRaises(LeakageError):
                self.verdict_of(outcome(), outcome(), outcome(), case)

    def test_generated_variant_records_its_parent_source(self):
        self.record_call([{"id": "r1"}])
        (name,) = load_cases(self.cases)
        generate(self.cases / name, self.cases)
        sources = {c.get("parent_source") for c in load_cases(self.cases).values() if c["source"] == "generated"}
        self.assertEqual(sources, {"tests"})

    def test_waiver_needs_a_verbatim_spec_quote(self):
        (self.tmp / "checkpoint_2.md").write_text("Exit with code 3 on a bad rule.\n")
        real = {"case": "c", "spec_checkpoint": 2, "quote": "Exit with code 3 on a bad rule."}
        invented = {**real, "quote": "Exit with code 4."}
        args = (outcome(2), outcome(2), outcome(3))
        self.assertTrue(self.verdict_of(*args, waivers=[real], spec_dir=self.tmp)["pass"])
        self.assertFalse(self.verdict_of(*args, waivers=[invented], spec_dir=self.tmp)["pass"])

    def test_changed_written_file_is_a_difference(self):
        result = self.verdict_of(outcome(files={"out": "a"}), outcome(files={"out": "a"}), outcome(files={"out": "b"}))
        self.assertEqual(result["differences"][0]["fields"], ["files"])


if __name__ == "__main__":
    unittest.main()
