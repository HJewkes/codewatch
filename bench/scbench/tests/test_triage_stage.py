"""The triage stage wrapper: `codewatch triage` is a fake that writes, or does not write, triage.json."""

import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path

from findings.triage_stage import triage_stage

REPORT = {"cost": {"spentUsd": 1.5}, "verdicts": {"asked": 4, "written": 3},
          "traces": [{"inputTokens": 10, "outputTokens": 2, "cacheCreationInputTokens": 3, "cacheReadInputTokens": 5}]}


def fake_triage(exit_code=0, writes=True):
    def run(command, env, cwd):
        if writes:
            out = Path(cwd) / ".codewatch" / "audit"
            out.mkdir(parents=True, exist_ok=True)
            (out / "triage.json").write_text(json.dumps(REPORT))
        return subprocess.CompletedProcess(command, exit_code, "codewatch triage: 3 verdicts\n", "")
    return run


class TriageStageTest(unittest.TestCase):
    def setUp(self):
        self.workspace = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def stage(self, run):
        with redirect_stderr(StringIO()):
            return triage_stage(self.workspace, ["--run-id", "cp-1"], run)

    def test_the_report_line_carries_the_runs_spend_tokens_and_verdict_counts(self):
        code, report = self.stage(fake_triage())

        self.assertEqual(code, 0)
        self.assertEqual(report, {"outcome": "ok", "tokens": 20, "usd": 1.5, "items_in": 4, "items_out": 3})

    def test_an_earlier_runs_triage_json_is_not_reported_as_this_runs_spend(self):
        self.stage(fake_triage())

        code, report = self.stage(fake_triage(exit_code=1, writes=False))

        self.assertEqual((code, report["outcome"]), (1, "failed"))
        self.assertNotIn("usd", report)
        self.assertIn("spend is unknown", report["reason"])


if __name__ == "__main__":
    unittest.main()
