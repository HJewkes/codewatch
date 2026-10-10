import unittest

from analysis.gaming import mechanism_signals, split_symbols
from analysis.inputs import _parse_stage_log
from analysis.paired import paired_rows
from analysis.signals import (
    added_test_kind, backlog_open, kept_and_reverted, review_counts, split_commits,
    test_gap_items_per_phase, tests_added_by_kind,
)

from .test_gaming_paired import arms_with, fix_item, log, remediation, result


def gap(status="kept", phase=1, missing=None, signal="missing-test-kind", **extra):
    return fix_item(status, phase, "test-gap", signal, (), missing=missing, **extra)


class DerivationTests(unittest.TestCase):
    def test_test_gap_items_are_counted_per_phase_whatever_their_fate(self):
        items = [gap(), gap("reverted"), gap(phase=3), fix_item(phase=2)]

        self.assertEqual(test_gap_items_per_phase(items), {1: 2, 3: 1})

    def test_commits_are_split_into_kept_and_reverted(self):
        items = [gap(), fix_item(), fix_item("reverted"), fix_item("not-started")]

        self.assertEqual(kept_and_reverted(items), (2, 1))

    def test_review_counts_conflicts_resumes_and_unresolved_conflicts(self):
        items = [
            fix_item(),
            fix_item(resumed=True, review="ok"),
            fix_item("reverted", resumed=True, review="conflict"),
        ]

        self.assertEqual(review_counts(items), {"conflicts": 2, "resumes_kept": 1, "unresolved": 1})

    def test_tests_added_are_binned_by_kind_from_kept_test_gaps_only(self):
        items = [
            gap(missing="snapshot or exact-output test"),
            gap(missing="error-path test"),
            gap(missing="exact value test"),
            gap(signal="symbol_weak_oracle_only"),
            gap(signal="diff-uncovered"),
            gap("reverted", missing="snapshot test"),
            fix_item(),
        ]

        self.assertEqual(
            tests_added_by_kind(items),
            {"snapshot_or_golden": 1, "exact_output": 2, "error_path": 1, "other": 1},
        )

    def test_a_missing_kind_without_evidence_is_other(self):
        self.assertEqual(added_test_kind(gap(missing=None)), "other")

    def test_backlog_is_unfixed_items_plus_those_held_back(self):
        items = [fix_item(), fix_item("reverted"), fix_item("not-started"), fix_item("unchanged")]

        self.assertEqual(backlog_open(items, held_back=2), 5)


class GamingPerCommitTests(unittest.TestCase):
    def test_only_kept_phase_two_and_three_commits_are_read(self):
        items = [
            fix_item(phase=1),
            fix_item(phase=2),
            fix_item(phase=3),
            fix_item("reverted", phase=2),
            fix_item(phase=2, flags=("cognitive",)),
        ]

        self.assertEqual(split_commits(items), [1, 1, 0])

    def test_split_symbols_sum_across_a_checkpoints_commits(self):
        stage = remediation("kept", fix_item(phase=2), fix_item(phase=3), fix_item("reverted"))

        self.assertEqual(split_symbols(result(stages=log(stage))), 2)


class MechanismReportTests(unittest.TestCase):
    def test_signals_come_from_the_fix_stage_items(self):
        stage = remediation(
            "kept", gap(), gap(phase=3, missing="error-path test"), fix_item(resumed=True), fix_item("reverted"),
            held_back=1,
        )
        rows = paired_rows(arms_with({("p", 1): result(stages=log(stage))}, a1a={}))

        signals = mechanism_signals(rows)

        self.assertEqual(signals["test_gap_items_by_phase"], {1: 1, 3: 1})
        self.assertEqual((signals["commits_kept"], signals["commits_reverted"]), (3, 1))
        self.assertEqual(signals["review_conflicts"], 1)
        self.assertEqual(signals["tests_added_by_kind"]["error_path"], 1)
        self.assertEqual(signals["backlog_open"], 2)

    def test_the_stage_json_reader_keeps_each_items_review_and_evidence(self):
        raw = {"stages": [{"stage": "fix", "status": "ok", "exit": 0, "held_back": 3, "items": [
            {"phase": 1, "kind": "test-gap", "signal": "missing-test-kind", "status": "kept",
             "missing": "snapshot test", "resumed": True, "review": {"verdict": "ok"},
             "added_symbols": [{"path": "a.py", "name": "f", "flags": ["pass-through"]}]},
        ]}]}

        stage = _parse_stage_log(raw).stages[0]

        item = stage.items[0]
        self.assertEqual((stage.held_back, item.phase, item.review_verdict, item.missing), (3, 1, "ok", "snapshot test"))
        self.assertEqual(item.added_symbols[0].flags, ("pass-through",))


if __name__ == "__main__":
    unittest.main()
