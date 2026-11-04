"""C-280 slice B: the probe's kill accounting, run against real pytest on a fixture tree."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from c280.mutants import sites
from c280.probe import Context, TreeRunner, probe_unit, rule_verdict

ENTRY = "def under(x):\n    return x < 3\n"
UNIT = "from entry import under\n\n\ndef test_unit():\n    assert under(2) is True\n    assert under(3) is False\n"
KEPT = "from entry import under\n\n\ndef test_boundary():\n    assert not under(3)\n"
KEPT_SUITE = "from entry import under\n\n\ndef test_low():\n    assert under(0)\n"


def tree(root: Path, name: str, tests: dict[str, str]) -> Path:
    base = root / name
    (base / "tests").mkdir(parents=True)
    (base / "tests" / "__init__.py").write_text("")
    (base / "entry.py").write_text(ENTRY)
    for fname, text in tests.items():
        (base / "tests" / fname).write_text(text)
    return base


HARNESS = """
import importlib, pathlib, sys
sys.path.insert(0, ".")
code = 0
for target in sys.argv[1:]:
    path, _, name = target.partition("::")
    files = sorted(pathlib.Path(path).glob("*.py")) if path == "tests" else [pathlib.Path(path)]
    for file in files:
        module = importlib.import_module(f"tests.{file.stem}")
        for fn in [n for n in vars(module) if n.startswith("test_") and name in ("", n)]:
            try:
                getattr(module, fn)()
            except Exception:
                code = 1
sys.exit(code)
"""


def runner(base: Path) -> TreeRunner:
    return TreeRunner(base, "entry.py", sys.executable, {"PATH": ""},
                      lambda targets: [sys.executable, "-B", "-c", HARNESS, *targets])


class ProbeTests(unittest.TestCase):
    def test_unique_kill_requires_kept_suite_to_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            unit_tree = tree(root, "unit", {"test_unit.py": UNIT})
            kept_tree = tree(root, "kept", {"test_boundary.py": KEPT})
            wanted = [m for m in sites(ENTRY) if m.op in {"rel", "none"}]
            ctx = Context(ENTRY, runner(unit_tree), runner(kept_tree), runner(unit_tree), lambda _u: {2},
                          lambda _line: ["tests/test_boundary.py::test_boundary"])

            row = probe_unit("tests/test_unit.py::test_unit", ctx, wanted)

            self.assertEqual((row["mutants"], row["kills"], row["unique_kills"]), (2, 2, 1))
            self.assertEqual(row["possibly_equivalent"], [])

    def test_a_mutant_nothing_kills_is_listed_as_possibly_equivalent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            unit_tree = tree(root, "unit", {"test_low.py": KEPT_SUITE})
            ctx = Context(ENTRY, runner(unit_tree), runner(unit_tree), runner(unit_tree), lambda _u: {2},
                          lambda _line: [])
            low = [m for m in sites(ENTRY) if m.op == "int" and m.replacement == "2"]

            row = probe_unit("tests/test_low.py::test_low", ctx, low)

            self.assertEqual((row["kills"], len(row["possibly_equivalent"])), (0, 1))

    def test_tree_runner_restores_the_entry_module(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = tree(Path(tmp), "unit", {"test_unit.py": UNIT})
            run = runner(base)

            killed = run(["tests"], "def under(x):\n    return None\n")

            self.assertTrue(killed)
            self.assertEqual((base / "entry.py").read_text(), ENTRY)

    def test_rule_needs_both_directions(self) -> None:
        rows = [{"unique_kills": 1, "admitted": True}, {"unique_kills": 0, "admitted": True},
                {"unique_kills": 1, "admitted": False}]

        verdict = rule_verdict(rows)

        self.assertEqual((verdict["a"], verdict["b"], verdict["passes"]), (0.5, 0.5, False))


if __name__ == "__main__":
    unittest.main()
