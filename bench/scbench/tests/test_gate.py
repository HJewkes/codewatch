"""The S4 gates (C-248): T1, T2, T3, the run preflight, the self-check CLI and the false-reject replay."""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from gate import __main__ as cli
from gate import preflight, replay, t3
from gate.family import check, render
from gate.gates import final_gate, test_bloat
from planner.families import load_config
from synthesis.taste import ModelReply
from tests.gate_fixtures import BAG, BASE, COSMETIC, NARROW, RETESTS, write_tree

CFG = load_config()
TASK = {"id": "app.py:handle", "owned": [{"key": "app.py:handle"}]}
GREEN = {"pass": True}
SELF_CHECK = """\
task app.py:handle   touched 25 -> 16 SLOC (0.64x, limit 1.50x)
family        before   delta/SLOC   tolerance   verdict
cx  cc            42      -1.41       improve     improved
cx  cognitive    107      -4.00       improve     improved
size              18      -0.56       +0.05       improved
iface in           8      -0.04       +1.40       held
iface cross        0      +0          +1          held
module        (-9 lines, 1 new fns)   3 allowed   held
constraints   T1 own ΔCC -3 <= 1 new fns: ok; common coupling: none; new flag origins: none; pass-through: none; \
unused params/locals: none; ownership: only owned symbols edited
result        advisory PASS (final gate runs after the session)
"""


def replies(*texts):
    queue = list(texts)

    def model(prompt):
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return ModelReply(text=item, tokens=10, usd=0.001)
    return model


def accept(n=1):
    return json.dumps({"verdict": "accept", "findings": [{"id": i, "real": False} for i in range(1, n + 1)],
                       "reason": "an accumulator the helper exists to fill"})


class Trees(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base = write_tree(self.tmp / "base", BASE, tests="def test_x():\n    assert True\n")

    def head(self, source, tests="def test_x():\n    assert True\n"):
        return write_tree(self.tmp / f"head{len(list(self.tmp.iterdir()))}", source, tests)

    def gate(self, source, visible=GREEN, diffgate=GREEN, model=None, tests="def test_x():\n    assert True\n"):
        return final_gate(self.base, self.head(source, tests), TASK, CFG, visible, diffgate, model or replies())


class T1(Trees):
    def test_failing_visible_tests_block_before_anything_else(self):
        got = self.gate(NARROW, visible={"pass": False, "failed": ["test_x"]})
        self.assertEqual((got["outcome"], got["tier"]), ("reject", "T1"))
        self.assertIn("visible tests fail: test_x", got["reasons"])

    def test_a_diffgate_difference_blocks(self):
        got = self.gate(NARROW, diffgate={"pass": False})
        self.assertEqual((got["outcome"], got["tier"]), ("reject", "T1"))

    def test_test_bloat_relative_to_base_blocks(self):
        bloated = "".join(f"def test_{i}():\n    assert {i} == {i}\n" for i in range(40))
        got = self.gate(NARROW, tests=bloated)
        self.assertEqual(got["tier"], "T1")
        self.assertTrue(any(r.startswith("test bloat") for r in got["reasons"]))

    def test_an_unchanged_test_ratio_is_no_bloat_even_above_the_ceiling(self):
        heavy = "".join(f"def test_{i}():\n    assert {i} == {i}\n" for i in range(40))
        base = write_tree(self.tmp / "heavy_base", BASE, heavy)
        self.assertTrue(test_bloat(base, write_tree(self.tmp / "heavy_head", BASE, heavy))["pass"])

    def test_own_body_cc_rising_past_the_new_functions_blocks(self):
        got = self.gate(RETESTS)
        self.assertEqual((got["outcome"], got["tier"]), ("reject", "T1"))
        self.assertIn("T1: own ΔCC +3 > 1 new functions", got["reasons"])
        self.assertIn("T1 own ΔCC +3 <= 1 new fns: FAIL", got["retry_message"])


class T2(Trees):
    def test_a_clean_extraction_is_accepted_without_a_review(self):
        got = self.gate(NARROW, model=replies(RuntimeError("must not be called")))
        self.assertEqual((got["outcome"], got["tier"]), ("accept", "T2"))
        self.assertEqual(got["report"]["utilities"], {"width": 1.0, "cross": 1.0})

    def test_a_new_helper_called_from_one_site_rejects(self):
        once = NARROW.replace('_size_label(item.size, "b")', '"b"').replace('_size_label(item.size, "c")', '"c"')
        got = self.gate(once)
        self.assertEqual((got["outcome"], got["tier"]), ("reject", "T2"))
        self.assertIn("adds a function called from one place: _size_label", got["reasons"])

    def test_a_new_helper_called_twice_is_still_accepted(self):
        self.assertEqual(self.gate(NARROW, model=replies(RuntimeError("no review")))["outcome"], "accept")

    def test_a_family_outside_tolerance_rejects_with_the_self_check_format(self):
        got = self.gate(COSMETIC)
        self.assertEqual((got["outcome"], got["tier"]), ("reject", "T2"))
        self.assertIn("cx  cc            42      +0.00       improve     FAIL", got["retry_message"])
        self.assertIn(VALUE := "the change removes too little complexity for the functions it adds", got["reasons"])
        self.assertIn(VALUE, got["retry_message"])
        self.assertNotIn("30", got["retry_message"].split("result")[1])

    def test_editing_a_unit_the_task_does_not_own_rejects(self):
        report = check(self.base, self.head(NARROW), {"id": "app.py:handle", "owned": [{"key": "app.py:other"}]}, CFG)
        self.assertEqual(report["ownership"], ["edited a unit the task does not own: app.py:handle"])
        self.assertFalse(report["pass"])

    def test_changing_the_frozen_head_signature_rejects(self):
        report = check(self.base, self.head(NARROW.replace("def handle(items)", "def handle(items, extra=None)")), TASK, CFG)
        self.assertEqual(report["ownership"], ["changed the frozen head signature: app.py:handle"])

    def test_a_constraint_break_goes_to_t3_with_its_evidence(self):
        got = self.gate(BAG, model=replies(accept()))
        self.assertEqual((got["outcome"], got["tier"]), ("accept", "T3"))
        self.assertEqual(got["reasons"], ["common: handle: bag:out"])


class T3(Trees):
    def test_a_real_degradation_is_rejected_with_a_retry_message(self):
        reply = json.dumps({"verdict": "reject", "findings": [{"id": 1, "real": True}], "reason": "shared list"})
        got = self.gate(BAG, model=replies(reply))
        self.assertEqual((got["outcome"], got["tier"]), ("reject", "T3"))
        self.assertIn("common coupling: handle: bag:out", got["retry_message"])

    def test_an_invalid_reply_is_retried_once_with_the_schema_error(self):
        prompts = []
        model = replies("not json", accept())
        got = self.gate(BAG, model=lambda p: (prompts.append(p), model(p))[1])
        self.assertEqual((got["outcome"], got["review"]["attempts"]), ("accept", 2))
        self.assertIn("Your previous reply was rejected: not JSON", prompts[1])

    def test_two_invalid_replies_hold_the_task(self):
        got = self.gate(BAG, model=replies('{"verdict": "accept"}', '{"verdict": "maybe"}'))
        self.assertEqual(got["outcome"], "review-unavailable")
        self.assertNotIn("retry_message", got)

    def test_a_reviewer_error_holds_the_task_instead_of_passing_it(self):
        got = self.gate(BAG, model=replies(RuntimeError("claude exited 1")))
        self.assertEqual((got["outcome"], got["review"]["reason"]), ("review-unavailable", "reviewer error: claude exited 1"))

    def test_a_verdict_that_disagrees_with_its_findings_is_invalid(self):
        with self.assertRaisesRegex(t3.ReplyError, "disagrees"):
            t3.parse_reply(json.dumps({"verdict": "accept", "findings": [{"id": 1, "real": True}], "reason": "x"}), 1)


class Preflight(unittest.TestCase):
    INIT = {"type": "system", "subtype": "init", "mcp_servers": [], "tools": ["Bash", "Read"]}

    def result(self, model="m-1", cap=64000):
        usage = {model: {"outputTokens": 5, **({"maxOutputTokens": cap} if cap else {})}}
        return {"type": "result", "modelUsage": usage}

    def test_matching_model_and_cap_pass(self):
        self.assertEqual(preflight.preflight([self.INIT, self.result()], "m-1", 64000), {"pass": True, "problems": []})

    def test_an_enforced_cap_below_the_requested_one_fails(self):
        got = preflight.preflight([self.INIT, self.result(cap=32000)], "m-1", 64000)
        self.assertEqual(got["problems"], ["output cap mismatch: expected 64000, effective 32000"])

    def test_another_model_or_an_unreported_cap_fails(self):
        self.assertIn("model mismatch", preflight.preflight([self.INIT, self.result("m-2")], "m-1", 64000)["problems"][0])
        self.assertEqual(preflight.preflight([self.INIT, self.result(cap=None)], "m-1", 64000)["problems"],
                         ["output cap not reported for m-1"])

    def test_a_session_shipping_mcp_tools_fails(self):
        init = {**self.INIT, "mcp_servers": [{"name": "codewatch"}], "tools": ["Bash", "mcp__codewatch__get_context"]}
        self.assertEqual(len(preflight.preflight([init, self.result()], "m-1", 64000)["problems"]), 2)


class SelfCheck(Trees):
    def run_cli(self, head, *extra):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(["--cluster", "app.py:handle", "--base", str(self.base), "--workspace", str(head),
                             "--calls", str(self.tmp / "calls.json"), *extra])
        return code, out.getvalue(), err.getvalue()

    def test_the_self_check_prints_families_and_verdicts_in_the_shared_format(self):
        code, out, _ = self.run_cli(self.head(NARROW))
        self.assertEqual((code, out), (0, SELF_CHECK))

    def test_the_retry_message_shares_the_self_check_format(self):
        report = check(self.base, self.head(NARROW), TASK, CFG)
        self.assertEqual(render(report, CFG, "FAIL: x").splitlines()[:-1], SELF_CHECK.splitlines()[:-1])

    def test_a_fourth_call_is_refused(self):
        head = self.head(NARROW)
        codes = [self.run_cli(head)[0] for _ in range(3)]
        code, _, err = self.run_cli(head)
        self.assertEqual((codes, code), ([0, 0, 0], 2))
        self.assertIn("budget spent (3 of 3", err)

    def test_the_json_form_carries_no_score_floor_or_utilities(self):
        _, out, _ = self.run_cli(self.head(COSMETIC), "--json")
        shown = json.loads(out)
        self.assertTrue(shown["result"].startswith("advisory FAIL: cx"))
        self.assertFalse({"gain", "value", "utilities", "score"} & set(shown))


class Replay(Trees):
    def test_the_replay_labels_pairs_and_pools_good_rejections(self):
        pairs = [{"set": "old", "id": "bag", "base": str(self.base), "head": str(self.head(BAG)), "expect": ["common"]},
                 {"set": "old", "id": "t1", "base": str(self.base), "head": str(self.head(RETESTS)), "expect": ["T1"]},
                 {"set": "c246", "id": "good", "base": str(self.base), "head": str(self.head(NARROW)), "good": True},
                 {"set": "c246", "id": "flat", "base": str(self.base), "head": str(self.head(COSMETIC)), "good": True}]
        got = replay.replay({"pairs": pairs}, CFG)
        self.assertEqual(got["old_b75"], {"match": 2, "n": 2, "differs": []})
        self.assertEqual(got["pooled_good"], {"rejected": 1, "n": 2, "share": 0.5})
        self.assertEqual(got["old_end_to_end"], [])

    def test_a_fold_counterfactual_of_a_clean_extraction_passes(self):
        fold = {"problem": "p", "cp": 1, "tree": str(self.head(NARROW)),
                "groups": {"app.py:handle": ["app.py:_size_label", "app.py:handle"]}}
        helpers: dict = {}
        rows = replay.judge_folds(fold, {**CFG, "hot_cc": 4}, set(), helpers)
        self.assertEqual([(r["head"], r["pass"], r["new"]) for r in rows], [("app.py:handle", True, 1)])
        self.assertEqual(replay.helper_rates(helpers)["n"], 1)

    def test_overrides_reach_nested_config_keys(self):
        cfg = replay.override(CFG, ["p5.module_lines_per_new_function=2", "p5.module_risk_basis=touched"])
        self.assertEqual((cfg["p5"]["module_lines_per_new_function"], cfg["p5"]["module_risk_basis"]), (2, "touched"))
        self.assertEqual(CFG["p5"]["module_lines_per_new_function"], 3)


if __name__ == "__main__":
    unittest.main()
