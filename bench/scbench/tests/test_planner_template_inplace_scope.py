import unittest

from planner.template import render
from tests.planner_fixtures import PINNED_CFG

WIDER = "then anywhere else in the head"


def task(edits, new):
    cands = [{"id": f"e{i}", "recipe": "R3", "unit": "p.py:Parser.f", "span": [3, 9], "in": ["a"],
              "out": ["b"], "width": 1} for i in range(edits)]
    return {"id": "p.py:Parser.f", "wave": 1, "candidates": cands, "owned": [], "frozen": [],
            "chosen": {"edits": [c["id"] for c in cands], "new": new,
                       "families": {"iface_budget": 0.1}}}


class InPlaceScope(unittest.TestCase):
    def test_in_place_render_widens_scope_to_whole_head(self):
        text = render(task(1, ["n"]), PINNED_CFG)
        self.assertIn(WIDER, text)
        self.assertIn("fewer decision points, no new functions", text)

    def test_ratchet_head_render_keeps_original_scope(self):
        text = render(task(2, ["n", "m"]), PINNED_CFG)
        self.assertNotIn(WIDER, text)
        self.assertIn("cx improves", text)


if __name__ == "__main__":
    unittest.main()
