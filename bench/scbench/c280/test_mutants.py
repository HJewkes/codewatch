"""C-280 slice B: the AST mutator's line scope and seeded caps."""

from __future__ import annotations

import unittest

from c280.mutants import PER_LINE, PER_UNIT, Mutant, apply, sample, sites

SOURCE = '''"""doc"""


def pick(x, y):
    if x < y:
        return x + 1
    raise ValueError("bad")


def many(a):
    return [a == 1, a == 2, a == 3, a == 4, a == 5, a == 6]
'''


class MutantTests(unittest.TestCase):
    def test_relational_swap_mutates_only_the_named_line(self) -> None:
        rel = next(m for m in sites(SOURCE) if m.op == "rel")

        mutated = apply(SOURCE, rel)

        changed = [i for i, (a, b) in enumerate(zip(SOURCE.split("\n"), mutated.split("\n"), strict=True), 1) if a != b]
        self.assertEqual(changed, [rel.line])
        self.assertIn("if x <= y:", mutated.split("\n")[rel.line - 1])
        self.assertEqual(rel.line, 5)

    def test_every_operator_finds_its_site(self) -> None:
        ops = {m.op for m in sites(SOURCE)}

        self.assertEqual(ops, {"rel", "int", "none", "str", "raise", "guard"})

    def test_docstrings_are_not_string_mutants(self) -> None:
        self.assertFalse([m for m in sites(SOURCE) if m.op == "str" and m.line == 1])

    def test_mutant_caps_are_seeded_and_bounded(self) -> None:
        big = "".join(f"def f{i}(a):\n    return a == {i} or a < {i + 1} or a > {i + 2}\n" for i in range(30))
        pool = sites(big)
        reached = {m.line for m in pool}

        first = sample(pool, reached, "280:unit")
        second = sample(list(reversed(pool)), reached, "280:unit")
        other = sample(pool, reached, "280:other")

        self.assertEqual(first, second)
        self.assertEqual(len(first), PER_UNIT)
        self.assertNotEqual(first, other)

    def test_at_most_three_mutants_per_line_and_only_on_reached_lines(self) -> None:
        pool = sites(SOURCE)

        drawn = sample(pool, {11}, "s")

        self.assertEqual({m.line for m in drawn}, {11})
        self.assertEqual(len(drawn), PER_LINE)

    def test_multibyte_text_before_the_span_keeps_columns_right(self) -> None:
        source = 'def f(a):\n    return "é" if a == 1 else 0\n'
        rel = next(m for m in sites(source) if m.op == "rel")

        self.assertIn('a != 1', apply(source, rel))

    def test_not_wraps_the_returned_expression(self) -> None:
        source = "def f(a):\n    return a > 1\n"
        negate = next(m for m in sites(source) if m.op == "not")

        self.assertEqual(apply(source, negate), "def f(a):\n    return not (a > 1)\n")
        self.assertIsInstance(negate, Mutant)


if __name__ == "__main__":
    unittest.main()
