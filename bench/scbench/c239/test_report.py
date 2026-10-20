"""The report's attention lines take cognitive complexity from the validated measure, not graph.db."""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from report import attention  # noqa: E402
from scan import functions  # noqa: E402

BASE_SRC = "def outer(xs):\n    return xs\n"
HEAD_SRC = '''def outer(xs):
    def inner(x):
        if x:
            for y in x:
                if y:
                    return y
        return None
    return [inner(x) for x in xs]
'''
STALE_DB_VALUE = 1.0


def _write_tree(root: Path, source: str) -> Path:
    root.mkdir(parents=True)
    (root / "mod.py").write_text(source)
    return root


def _stale_db(path: Path, symbol: str) -> str:
    c = sqlite3.connect(path)
    c.execute("create table snapshot (id integer)")
    c.execute("create table metric (snapshot_id integer, node_id text, name text, value real)")
    c.execute("insert into snapshot values (1)")
    c.execute("insert into metric values (1, ?, 'symbol_cognitive', ?)", (f"mod.py#{symbol}", STALE_DB_VALUE))
    c.commit()
    c.close()
    return str(path)


class AttentionCognitiveTest(unittest.TestCase):
    def test_nested_closure_reports_validated_value_not_graph_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base, head = _write_tree(tmp / "base", BASE_SRC), _write_tree(tmp / "head", HEAD_SRC)
            findings = tmp / "findings.jsonl"
            findings.write_text(json.dumps({"signal": "symbol-cognitive", "symbol": "outer"}) + "\n")
            db = _stale_db(tmp / "graph.db", "outer")
            args = Namespace(findings=str(findings), base=str(base), head=str(head), base_db=db, head_db=db)

            lines = attention(functions(base), functions(head), args)

        self.assertEqual(len(lines), 1)
        # Catches: reading symbol_cognitive from graph.db again (the line would say "1 -> 1").
        self.assertIn("outer cognitive 0 -> 6 this change", lines[0])


if __name__ == "__main__":
    unittest.main()
