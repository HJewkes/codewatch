import unittest

from planner.families import load_config
from planner.template import render

CFG = load_config()


def task(edits, new):
    cands = [{"id": f"e{i}", "recipe": "R3", "unit": "p.py:Parser.f", "span": [3, 9], "in": ["a"],
              "out": ["b"], "width": 1} for i in range(edits)]
    return {"id": "p.py:Parser.f", "wave": 1, "candidates": cands, "owned": [], "frozen": [],
            "chosen": {"edits": [c["id"] for c in cands], "new": new,
                       "families": {"iface_budget": 0.1}}}


class InPlaceTemplate(unittest.TestCase):
    def test_single_cut_with_one_new_function_renders_in_place(self):
        text = render(task(1, ["n"]), CFG)
        self.assertIn("recipe: simplify in place\n", text)
        self.assertIn("new_functions: none\n", text)
        self.assertNotIn("stage extraction", text)

    def test_two_cut_stage_extraction_renders_as_before(self):
        text = render(task(2, ["n", "m"]), CFG)
        self.assertIn("R3 stage extraction", text)
        self.assertIn("new_functions: place directly after", text)


if __name__ == "__main__":
    unittest.main()
