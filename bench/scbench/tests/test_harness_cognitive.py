import json
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent / "c239" / "harness"

HOT = textwrap.dedent("""
    def hot(xs):
        for x in xs:
            if x:
                if x > 1:
                    if x > 2:
                        if x > 3:
                            if x > 4:
                                return x
        return 0


    def cool(x):
        return x and 1
""")


def workspace(root: Path, src: str) -> Path:
    (root / "pkg").mkdir(parents=True)
    (root / "pkg" / "core.py").write_text(src)
    (root / "tests").mkdir()
    (root / "tests" / "test_core.py").write_text(HOT.replace("def hot", "def test_hot"))
    return root


def audit_db(ws: Path) -> Path:
    db = ws / ".codewatch" / "graph.db"
    db.parent.mkdir()
    c = sqlite3.connect(db)
    c.executescript("create table snapshot (id integer); insert into snapshot values (1);"
                    "create table metric (snapshot_id, node_id, name, value);"
                    "insert into metric values (1, 'pkg/core.py#hot', 'symbol_cyclomatic', 7);"
                    "insert into metric values (1, 'pkg/core.py#hot', 'symbol_body_lines', 8);")
    c.commit()
    c.close()
    return db


def run(script: str, *args) -> str:
    done = subprocess.run([sys.executable, "-I", str(HARNESS / script), *map(str, args)],
                          capture_output=True, text=True, check=True)
    return done.stdout


class Metrics(unittest.TestCase):
    def test_cognitive_comes_from_source_files_and_leaves_tests_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = workspace(Path(tmp), HOT)
            audit_db(ws)
            out = json.loads(run("metrics.py", ws))
        self.assertEqual((out["cog_max"], out["cog_over_15"], out["src_symbols"]), (21, 1, 2))
        self.assertTrue(out["audited"])

    def test_a_workspace_the_audit_left_no_graph_for_is_not_audited(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = json.loads(run("metrics.py", workspace(Path(tmp), HOT)))
        self.assertFalse(out["audited"])
        self.assertEqual(out["cog_max"], 21)


class Targets(unittest.TestCase):
    def test_touched_functions_are_ranked_by_cognitive_with_graph_cc_and_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = workspace(Path(tmp) / "base", HOT.replace("x > 4", "x > 5"))
            head = workspace(Path(tmp) / "head", HOT)
            out = run("targets.py", base, head, audit_db(head))
        self.assertEqual(out, "- hot: cognitive 21, cyclomatic 7, 8 body lines (touched by this change)\n")


if __name__ == "__main__":
    unittest.main()
