"""The fix stage writes its ordered item list beside the findings, for the agent to keep."""

import json
import unittest

from remediation.stage import ITEMS_FILE
from tests.remediation_support import FakeClaude, FakeTools, StageTestCase, confirmed, write_verdicts


class ItemListTest(StageTestCase):
    def items_file(self):
        return self.root / ".codewatch" / "audit" / ITEMS_FILE

    def test_the_item_list_is_written_in_the_order_the_stage_works_it(self):
        write_verdicts(self.root, [confirmed("symbol-cognitive", "src/app.py"),
                                   confirmed("symbol_weak_oracle_only", "tests/test_app.py")])

        report = self.run_stage(FakeClaude(), FakeTools())

        rows = [json.loads(line) for line in self.items_file().read_text().splitlines()]
        self.assertEqual([(r["signal"], r["path"]) for r in rows],
                         [("symbol_weak_oracle_only", "tests/test_app.py"), ("symbol-cognitive", "src/app.py")])
        self.assertEqual([(r["signal"], r["path"]) for r in rows], [(i["signal"], i["path"]) for i in report["items"]])

    def test_a_skipped_stage_leaves_no_item_list_from_an_earlier_checkpoint(self):
        self.items_file().parent.mkdir(parents=True, exist_ok=True)
        self.items_file().write_text('{"signal": "stale"}\n')
        write_verdicts(self.root, [confirmed()])
        (self.root / "src" / "app.py").write_text("x = 5\n")

        report = self.run_stage(FakeClaude(), FakeTools())

        self.assertEqual(report["outcome"], "skipped")
        self.assertFalse(self.items_file().exists())


if __name__ == "__main__":
    unittest.main()
