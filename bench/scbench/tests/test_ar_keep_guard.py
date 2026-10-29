import json
import unittest
from statistics import median

from tests.ar_fixtures import BENCH

METRIC = json.loads((BENCH / "autoresearch" / "target.json").read_text())["metric"]


def guard_hit(best: list[dict], idea: list[dict]) -> str | None:
    """The engine's guard check (titan-platform packages/autoresearch keep.ts): a number is a `min` guard with that slack."""
    for name, guard in METRIC["guards"].items():
        slack, direction = (guard, "min") if isinstance(guard, (int, float)) else (guard["slack"], guard["direction"])
        idea_m, best_m = (median(run[name] for run in runs) for runs in (idea, best))
        if (idea_m > best_m + slack) if direction == "min" else (idea_m < best_m - slack):
            return name
    return None


def runs(cc: float, accepted: int, count: int = 3) -> list[dict]:
    return [{"cc_total_delta_pct": cc, "single_caller_delta": 0, "accepted_tasks": accepted}] * count


class AcceptedTaskGuardTests(unittest.TestCase):
    def test_lower_cc_with_fewer_accepted_tasks_than_the_baseline_fails_the_keep(self):
        self.assertEqual(guard_hit(best=runs(cc=1.7, accepted=4), idea=runs(cc=-1.7, accepted=2)), "accepted_tasks")

    def test_lower_cc_with_the_baseline_accepted_count_passes_the_guards(self):
        self.assertIsNone(guard_hit(best=runs(cc=1.7, accepted=4), idea=runs(cc=-1.7, accepted=4)))

    def test_more_accepted_tasks_than_the_baseline_passes_the_guards(self):
        self.assertIsNone(guard_hit(best=runs(cc=1.7, accepted=2), idea=runs(cc=1.7, accepted=4)))

    def test_single_caller_guard_is_unchanged(self):
        idea = [{**run, "single_caller_delta": 2} for run in runs(cc=-1.7, accepted=4)]
        self.assertEqual(guard_hit(best=runs(cc=1.7, accepted=4), idea=idea), "single_caller_delta")


if __name__ == "__main__":
    unittest.main()
