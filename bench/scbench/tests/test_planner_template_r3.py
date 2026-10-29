import unittest

from planner.template import render

COLLAPSE = "collapse conditions that become redundant"


def task(recipe: str) -> dict:
    edit = {"id": "e1", "recipe": recipe, "unit": "m.py:_walk", "span": [3, 9], "in": ["a"], "out": ["b"],
            "width": 1, "rejected": []}
    return {"id": "m.py:_walk", "wave": 1, "owned": [{"key": "m.py:_walk"}], "frozen": [],
            "candidates": [edit], "chosen": {"edits": ["e1"], "families": None}}


CFG = {"p5": {"crossings": 1, "module_lines_per_new_function": 20, "amount_ratio": 1.5}}


class R3TemplateTest(unittest.TestCase):
    def test_r3_task_includes_the_collapse_rule(self):
        self.assertIn(COLLAPSE, render(task("R3"), CFG))

    def test_base_recipe_omits_the_collapse_rule(self):
        self.assertNotIn(COLLAPSE, render(task("R2"), CFG))


if __name__ == "__main__":
    unittest.main()
