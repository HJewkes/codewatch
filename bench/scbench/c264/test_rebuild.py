"""C-264 S1 rebuild, on a synthetic checkpoint with two reviewer transcripts."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from c264.rebuild import TRANSCRIPTS, RebuildError, fix_items, join, read_reviews, rebuild_checkpoint

QUESTION = "Does this commit change behaviour that the specification defines?\n(question)"
SOURCE_BEFORE = "def add(a, b):\n    return a+b\n"
SOURCE_AFTER = "def add(a, b):\n    return a + b\n"
TEST_FILE = "from app import add\n\n\ndef test_add():\n    assert add(1, 2) == 3  #   kept\n"

QUALITY_DIFF = """\
diff --git a/app.py b/app.py
index 1111111..2222222 100644
--- a/app.py
+++ b/app.py
@@ -1,2 +1,2 @@
 def add(a, b):
-    return a+b
+    return a + b
"""
TEST_DIFF = """\
diff --git a/tests/test_app.py b/tests/test_app.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/tests/test_app.py
@@ -0,0 +1,5 @@
""" + "".join(f"+{line}\n" for line in TEST_FILE.split("\n")[:-1])


def item(kind: str, symbol: str, reason: str) -> dict:
    return {"kind": kind, "signal": "missing-test-kind" if kind == "test-gap" else "clone",
            "symbol": symbol, "path": "app.py", "status": "kept", "commit": "c0ffee",
            "review": {"verdict": "ok", "reason": reason}}


def transcript(session: str, enqueued: str, diff: str, reason: str) -> str:
    prompt = "\n\n".join([QUESTION, "Commit diff:\n" + diff]) + "\n"
    reply = json.dumps({"verdict": "ok", "spec_line": None, "reason": reason})
    records = [
        {"type": "queue-operation", "operation": "enqueue", "timestamp": enqueued, "content": prompt},
        {"type": "user", "sessionId": session, "timestamp": enqueued, "message": {"role": "user", "content": prompt}},
        {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": ""}]}},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": reply}]}},
    ]
    return "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n"


def write_checkpoint(root: Path, items: list[dict]) -> Path:
    cp = root / "checkpoint_1"
    (cp / TRANSCRIPTS).mkdir(parents=True)
    (cp / "snapshot" / "tests").mkdir(parents=True)
    (cp / "snapshot" / "app.py").write_text(SOURCE_AFTER)
    (cp / "snapshot" / "tests" / "test_app.py").write_text(TEST_FILE)
    stages = {"stages": [{"stage": "audit"}, {"stage": "fix", "items": items}]}
    (cp / "agent" / "stages.json").write_text(json.dumps(stages))
    # file names sort opposite to enqueue time, so only the timestamps give the order
    (cp / TRANSCRIPTS / "a.jsonl").write_text(transcript("s-test", "2026-01-01T00:02:00Z", TEST_DIFF, "adds a test"))
    (cp / TRANSCRIPTS / "b.jsonl").write_text(transcript("s-quality", "2026-01-01T00:01:00Z", QUALITY_DIFF, "spacing"))
    return cp


class JoinTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def test_items_pair_with_transcripts_in_enqueue_order(self):
        cp = write_checkpoint(self.root, [item("quality", "add", "spacing"), item("test-gap", "add", "adds a test")])
        pairs = join(fix_items(cp / "agent" / "stages.json"), read_reviews(cp / TRANSCRIPTS))
        self.assertEqual([(i["kind"], r.session) for i, r in pairs], [("quality", "s-quality"), ("test-gap", "s-test")])
        self.assertEqual(pairs[1][1].diff, TEST_DIFF)

    def test_items_out_of_transcript_order_are_refused(self):
        cp = write_checkpoint(self.root, [item("test-gap", "add", "adds a test"), item("quality", "add", "spacing")])
        with self.assertRaises(RebuildError):
            join(fix_items(cp / "agent" / "stages.json"), read_reviews(cp / TRANSCRIPTS))

    def test_a_missing_transcript_is_refused(self):
        cp = write_checkpoint(self.root, [item("quality", "add", "spacing"), item("test-gap", "add", "adds a test")])
        (cp / TRANSCRIPTS / "a.jsonl").unlink()
        with self.assertRaises(RebuildError):
            join(fix_items(cp / "agent" / "stages.json"), read_reviews(cp / TRANSCRIPTS))

    def test_the_base_is_the_pre_fix_tree_and_rows_follow_the_items(self):
        cp = write_checkpoint(self.root, [item("quality", "add", "spacing"), item("test-gap", "add", "adds a test")])
        out = self.root / "out"
        rows = rebuild_checkpoint("demo", 1, cp, out)
        base = out / "base" / "demo" / "cp1"
        self.assertEqual((base / "app.py").read_text(), SOURCE_BEFORE)
        self.assertFalse((base / "tests" / "test_app.py").exists())
        self.assertEqual([(r["order"], r["kind"], r["diff"]) for r in rows],
                         [(1, "quality", "diffs/demo/cp1/01.diff"), (2, "test-gap", "diffs/demo/cp1/02.diff")])
        self.assertEqual((out / rows[1]["diff"]).read_text(), TEST_DIFF)


if __name__ == "__main__":
    unittest.main()
