import ast
import textwrap
import unittest

from calibration.cognitive import cognitive

# (scenario, source, scb-check 0.1.3's value, own-body value). Each is a construct the round 3 port
# counted differently; the values were checked against scb-check itself.
CASES = [
    ("elif and else cost one more than their if", """
        def f(x):
            if x:
                pass
            elif x > 1:
                pass
            else:
                pass
    """, 5, 5),
    ("an elif inside a loop sits one level below its if", """
        def f(xs):
            for x in xs:
                if x:
                    pass
                elif x > 1:
                    pass
    """, 6, 6),
    ("an if inside an else block is nested, not an elif", """
        def f(x):
            if x:
                pass
            else:
                if x > 1:
                    pass
    """, 6, 6),
    ("each boolean operator costs one, not each run", """
        def f(a, b, c, d):
            return a and b and c or d
    """, 3, 3),
    ("break and continue cost one each", """
        def f(xs):
            for x in xs:
                if x:
                    continue
                break
    """, 5, 5),
    ("a try's else costs one at the try's level and finally nothing", """
        def f():
            try:
                pass
            except ValueError:
                pass
            else:
                pass
            finally:
                pass
    """, 2, 2),
    ("a loop's else costs one more than its loop", """
        def f(xs):
            while xs:
                pass
            else:
                pass
    """, 3, 3),
    ("comprehensions cost nothing but a ternary inside them does", """
        def f(xs):
            a = [x for x in xs if x]
            return {x: x if x else 0 for x in a}
    """, 1, 1),
    ("match and case cost nothing and do not nest", """
        def f(x):
            match x:
                case 1:
                    if x:
                        pass
    """, 1, 1),
    ("a ternary in an if's test sits one level deeper", """
        def f(x, a, b):
            if (a if x else b):
                pass
    """, 3, 3),
    ("nested defs and their decorators count in the parent, lambdas in the own body", """
        def outer(xs):
            @deco(1 if xs else 2)
            def inner(y):
                if y:
                    return y
            key = lambda v: v or 0
            return inner, key
    """, 3, 1),
    ("default values count and the function's own decorators do not", """
        @deco(1 if a else 2)
        def f(x=1 if a else 2):
            return x
    """, 1, 1),
]


def first_def(src: str) -> ast.FunctionDef:
    return next(n for n in ast.parse(textwrap.dedent(src)).body if isinstance(n, ast.FunctionDef))


class Cognitive(unittest.TestCase):
    def test_each_construct_is_counted_as_scb_check_counts_it(self):
        for scenario, src, scb, _ in CASES:
            with self.subTest(scenario):
                self.assertEqual(cognitive(first_def(src)), scb)

    def test_own_body_leaves_nested_defs_out(self):
        for scenario, src, _, own in CASES:
            with self.subTest(scenario):
                self.assertEqual(cognitive(first_def(src), own_body=True), own)

    @unittest.skipUnless(hasattr(ast, "TryStar"), "except* needs Python 3.11")
    def test_an_except_group_handler_counts_as_an_except(self):
        src = "def f():\n    try:\n        pass\n    except* ValueError:\n        pass\n"
        self.assertEqual(cognitive(first_def(src)), 1)


if __name__ == "__main__":
    unittest.main()
