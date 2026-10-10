"""Fragment fold tests: the pure fold, then the merging job on a real hidden repository."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from prflow.repo import HiddenRepo
from synthesis.fold import anchor_of, fold_taste, fold_verdicts, id_order
from synthesis.fold_job import head_anchors, run_fold

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "plugin" / "fixtures"
OWNER = "- Errors are raised at the CLI edge; library functions never print. {owner docs/style.md}"
CART_KEY = "code-graph:symbol-pass-through:shop/cart.py#Cart:0a1b2c3d4e5f6a7b#0"
TOTAL_KEY = "diff-uncovered:diff-uncovered:shop/cart.py#Cart.total:2c3d4e5f6a7b8c9d#0"
CLONE_KEY = "code-graph:clone:shop/cart.py:3d4e5f6a7b8c9d0e#0"
GONE_KEY = "code-graph:symbol-cognitive:shop/old.py#legacy:4e5f6a7b8c9d0e1f#0"


def _row(key: str, verdict: str) -> str:
    return json.dumps({"key": key, "verdict": verdict, "path": key.split(":")[2].split("#")[0]})


def _everywhere(_anchor: str) -> bool:
    return True


class FoldTasteTest(unittest.TestCase):
    def test_an_inferred_line_replaces_the_earlier_one_with_its_key_in_place(self) -> None:
        head = f"- Old Cart note {{inferred cp1 fp:{CART_KEY}}}\n{OWNER}\n"

        folded = fold_taste(head, [("cp-2.md", f"- New Cart note {{inferred cp2 fp:{CART_KEY}}}\n")])

        self.assertEqual(folded.head, f"- New Cart note {{inferred cp2 fp:{CART_KEY}}}\n{OWNER}\n")
        self.assertEqual(folded.absorbed, ["cp-2.md"])

    def test_a_line_already_in_the_head_is_not_repeated(self) -> None:
        folded = fold_taste(f"{OWNER}\n", [("cp-2.md", f"{OWNER}\n")])

        self.assertEqual(folded.head, f"{OWNER}\n")

    def test_folds_the_c187_fixtures_into_one_head(self) -> None:
        head, fragment = (FIXTURES / "taste.md").read_text(), (FIXTURES / "taste-fragment.md").read_text()

        folded = fold_taste(head, [("cp-2.md", fragment)])

        self.assertEqual(folded.head, head + fragment)


class FoldVerdictsTest(unittest.TestCase):
    def test_reads_the_anchor_of_a_symbol_key_and_of_a_file_key(self) -> None:
        self.assertEqual(anchor_of(TOTAL_KEY), "shop/cart.py#Cart.total")
        self.assertEqual(anchor_of(CLONE_KEY), "shop/cart.py")
        self.assertIsNone(anchor_of("not a finding key"))

    def test_orders_fragment_ids_by_number(self) -> None:
        self.assertEqual(id_order(["cp-10.md", "cp-2.md", "run-b.md", "cp-1.md"]),
                         ["cp-1.md", "cp-2.md", "cp-10.md", "run-b.md"])

    def test_drops_a_key_whose_anchor_is_absent_from_the_head_snapshot(self) -> None:
        head = f"{_row(GONE_KEY, 'confirmed')}\n{_row(CLONE_KEY, 'confirmed')}\n"

        folded = fold_verdicts(head, [("cp-2.jsonl", f"{_row(TOTAL_KEY, 'unclear')}\n")],
                               {"shop/cart.py", "shop/cart.py#Cart.total"}.__contains__)

        self.assertEqual([json.loads(line)["key"] for line in folded.head.splitlines()], [CLONE_KEY, TOTAL_KEY])

    def test_folds_the_c187_fixtures_with_the_fragment_row_winning(self) -> None:
        head, fragment = (FIXTURES / "verdicts.jsonl").read_text(), (FIXTURES / "verdicts-fragment.jsonl").read_text()

        folded = fold_verdicts(head, [("cp-2.jsonl", fragment)], _everywhere)

        rows = {row["key"]: row["verdict"] for row in map(json.loads, folded.head.splitlines())}
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[TOTAL_KEY], "confirmed")

    def test_a_malformed_head_folds_nothing(self) -> None:
        folded = fold_verdicts("{not json\n", [("cp-2.jsonl", f"{_row(TOTAL_KEY, 'confirmed')}\n")], _everywhere)

        self.assertEqual((folded.head, folded.absorbed), ("{not json\n", []))
        self.assertIn("cp-2.jsonl", folded.malformed)


class FoldJobTest(unittest.TestCase):
    def setUp(self) -> None:
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        patcher = mock.patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = HiddenRepo.at(Path(scratch.name))
        self.codewatch = self.repo.workspace / ".codewatch"
        self.repo.init()
        self.repo.ensure_excludes()
        self.write("taste.md", (FIXTURES / "taste.md").read_text())
        self.write("verdicts.jsonl", (FIXTURES / "verdicts.jsonl").read_text())
        self.repo.commit_all("main: carry heads")

    def write(self, rel: str, text: str) -> None:
        (self.codewatch / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.codewatch / rel).write_text(text)

    def commit_fragments(self, fragments: dict[str, str]) -> str:
        for rel, text in fragments.items():
            self.write(rel, text)
        return self.repo.commit_all("cp-2: fragments")

    def changed_in_head(self) -> list[str]:
        return self.repo.run("show", "--name-only", "--format=", "HEAD").splitlines()

    def test_never_edits_or_removes_an_owner_line(self) -> None:
        owner_text = OWNER.removesuffix(" {owner docs/style.md}")
        self.commit_fragments({"taste.d/cp-2.md": f"{owner_text} {{inferred cp2 fp:{CART_KEY}}}\n"})

        report = run_fold(self.repo, None)

        self.assertEqual(report["outcome"], "folded")
        lines = (self.codewatch / "taste.md").read_text().splitlines()
        self.assertEqual(lines[0], OWNER)
        self.assertEqual(lines[1], f"{owner_text} {{inferred cp2 fp:{CART_KEY}}}")

    def test_two_fragments_on_one_key_fold_in_id_order_in_one_commit(self) -> None:
        self.commit_fragments({"verdicts.d/cp-10.jsonl": f"{_row(TOTAL_KEY, 'justified')}\n",
                               "verdicts.d/cp-2.jsonl": f"{_row(TOTAL_KEY, 'confirmed')}\n",
                               "taste.d/cp-10.md": f"- Later {{inferred cp10 fp:{CART_KEY}}}\n",
                               "taste.d/cp-2.md": f"- Earlier {{inferred cp2 fp:{CART_KEY}}}\n"})

        report = run_fold(self.repo, None)

        rows = [json.loads(line) for line in (self.codewatch / "verdicts.jsonl").read_text().splitlines()]
        self.assertEqual([r["verdict"] for r in rows if r["key"] == TOTAL_KEY], ["justified"])
        self.assertIn(f"- Later {{inferred cp10 fp:{CART_KEY}}}", (self.codewatch / "taste.md").read_text())
        self.assertEqual(report["fold_commit"], self.repo.rev("HEAD"))
        self.assertEqual(sorted(self.changed_in_head()), [
            ".codewatch/taste.d/cp-10.md", ".codewatch/taste.d/cp-2.md", ".codewatch/taste.md",
            ".codewatch/verdicts.d/cp-10.jsonl", ".codewatch/verdicts.d/cp-2.jsonl", ".codewatch/verdicts.jsonl"])
        self.assertFalse(self.repo.dirty())

    def test_leaves_a_malformed_fragment_in_place_and_reports_it(self) -> None:
        self.commit_fragments({"verdicts.d/cp-2.jsonl": "{not json\n",
                               "taste.d/cp-2.md": "- A line with no provenance tag\n",
                               "taste.d/cp-3.md": f"- Kept {{inferred cp3 fp:{CLONE_KEY}}}\n"})

        report = run_fold(self.repo, None)

        self.assertEqual(report["malformed"], {"taste.d/cp-2.md": "line 1 has no provenance tag",
                                               "verdicts.d/cp-2.jsonl": "line 1 is not a verdict row"})
        self.assertEqual(report["absorbed"], 1)
        self.assertEqual((self.codewatch / "verdicts.d" / "cp-2.jsonl").read_text(), "{not json\n")
        self.assertTrue((self.codewatch / "taste.d" / "cp-2.md").is_file())
        self.assertEqual(self.changed_in_head(), [".codewatch/taste.d/cp-3.md", ".codewatch/taste.md"])

    def test_makes_no_commit_without_fragments_so_a_second_fold_is_a_no_op(self) -> None:
        before = self.repo.rev("HEAD")

        self.assertEqual(run_fold(self.repo, None), {"absorbed": 0, "anchors": "unknown", "outcome": "nothing_to_fold"})
        self.assertEqual(self.repo.rev("HEAD"), before)

        self.commit_fragments({"taste.d/cp-2.md": f"- Note {{inferred cp2 fp:{CLONE_KEY}}}\n"})
        run_fold(self.repo, None)
        folded = self.repo.rev("HEAD")
        self.assertEqual(run_fold(self.repo, None)["outcome"], "nothing_to_fold")
        self.assertEqual(self.repo.rev("HEAD"), folded)

    def test_reads_head_anchors_from_the_snapshot_node_table(self) -> None:
        db = self.repo.workspace / "graph.db"
        with sqlite3.connect(db) as conn:
            conn.execute("CREATE TABLE node (snapshot_id INTEGER, id TEXT, kind TEXT)")
            conn.executemany("INSERT INTO node VALUES (?, ?, 'symbol')", [(8, "shop/cart.py#Cart"), (7, "shop/old.py#legacy")])
        conn.close()

        present = head_anchors(db, 8)

        self.assertTrue(present("shop/cart.py#Cart"))
        self.assertFalse(present("shop/old.py#legacy"))
        self.assertIsNone(head_anchors(db, None))
        self.assertIsNone(head_anchors(self.repo.workspace / "missing.db", 8))


if __name__ == "__main__":
    unittest.main()
