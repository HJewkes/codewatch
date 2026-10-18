"""The inject stage on a scratch home and workspace; the plugin's own hook and launcher run for real."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from prflow.repo import HiddenRepo

from inject import SERVER_NAME, enable

BENCH = Path(__file__).resolve().parents[1]
PLUGIN = BENCH.parents[1] / "plugins" / "codewatch"
TASTE_LINE = "- Name money helpers after the unit they return. {owner}"
VERDICT = {"key": "fp:shop/pricing.py:total_cents", "verdict": "confirmed", "signal": "diff-uncovered",
           "path": "shop/pricing.py", "rationale": "total_cents has no test for a negative quantity.",
           "citations": [{"lineStart": 7}]}


def run_inject(home: Path, workspace: Path, plugin_root: Path = PLUGIN) -> subprocess.CompletedProcess:
    env = {**os.environ, "HOME": str(home), "PYTHONPATH": str(BENCH)}
    return subprocess.run([sys.executable, "-P", "-m", "inject", "--workspace", str(workspace),
                           "--plugin-root", str(plugin_root)], env=env, capture_output=True, text=True, check=False)


class ScratchTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.home, self.workspace = self.tmp / "home", self.tmp / "workspace"
        self.home.mkdir()
        self.workspace.mkdir()

    def settings(self) -> dict:
        return json.loads((self.home / ".claude" / "settings.json").read_text())

    def user_config(self) -> dict:
        return json.loads((self.home / ".claude.json").read_text())


@unittest.skipUnless(shutil.which("node"), "the plugin's hook runs under node")
class SessionStartTest(ScratchTestCase):
    def write_carry(self):
        carry = self.workspace / ".codewatch"
        (carry / "verdicts.d").mkdir(parents=True)
        (carry / "taste.md").write_text(f"{TASTE_LINE}\n")
        (carry / "verdicts.d" / "cp-1.jsonl").write_text(json.dumps(VERDICT) + "\n")

    def run_session_start_hook(self) -> dict:
        [entry] = self.settings()["hooks"]["SessionStart"]
        env = {"PATH": os.environ["PATH"], "HOME": str(self.home), "CLAUDE_PROJECT_DIR": str(self.workspace)}
        done = subprocess.run(["/bin/sh", "-c", entry["hooks"][0]["command"]], cwd=self.workspace, env=env,
                              capture_output=True, text=True, timeout=30, check=True)
        return json.loads(done.stdout)["hookSpecificOutput"]

    def test_the_enabled_hook_hands_the_next_session_the_taste_lines_and_a_carried_verdict(self):
        self.write_carry()

        done = run_inject(self.home, self.workspace)
        output = self.run_session_start_hook()

        self.assertEqual(json.loads(done.stdout.splitlines()[-1]), {"outcome": "enabled", "items_out": 2})
        self.assertEqual(output["hookEventName"], "SessionStart")
        self.assertIn(TASTE_LINE, output["additionalContext"])
        self.assertIn("- [test-gap] shop/pricing.py:7: total_cents has no test for a negative quantity.",
                      output["additionalContext"])


class ClaudeConfigTest(ScratchTestCase):
    def test_a_rerun_keeps_one_codewatch_entry_and_every_other_setting(self):
        other_hook = {"matcher": "startup", "hooks": [{"type": "command", "command": "echo other"}]}
        (self.home / ".claude").mkdir()
        (self.home / ".claude" / "settings.json").write_text(json.dumps(
            {"env": {"ANTHROPIC_API_KEY": ""}, "hooks": {"SessionStart": [other_hook]}}))
        (self.home / ".claude.json").write_text(json.dumps({"numStartups": 3, "mcpServers": {"other": {}}}))

        enable(self.home, self.workspace, PLUGIN)
        enable(self.home, self.workspace, PLUGIN)

        settings, config = self.settings(), self.user_config()
        self.assertEqual(settings["env"], {"ANTHROPIC_API_KEY": ""})
        self.assertEqual(settings["hooks"]["SessionStart"][0], other_hook)
        self.assertEqual(len(settings["hooks"]["SessionStart"]), 2)
        self.assertEqual(sorted(config["mcpServers"]), [SERVER_NAME, "other"])
        self.assertEqual(config["numStartups"], 3)
        server = config["mcpServers"][SERVER_NAME]
        self.assertEqual(server["command"], str(PLUGIN / "bin" / "codewatch-launch.sh"))
        self.assertEqual(server["env"]["GIT_DIR"], str(self.workspace / ".codewatch" / "repo.git"))

    def test_a_plugin_root_without_the_hook_fails_the_stage_and_writes_nothing(self):
        done = run_inject(self.home, self.workspace, plugin_root=self.tmp / "no-plugin")

        self.assertEqual(done.returncode, 1)
        self.assertIn("has no SessionStart hook", done.stderr)
        self.assertEqual(list(self.home.iterdir()), [])


class McpLauncherTest(ScratchTestCase):
    def test_the_enabled_server_starts_the_cli_against_the_hidden_repository(self):
        repo = HiddenRepo.at(self.workspace)
        repo.init()
        (self.workspace / ".codewatch" / "graph.db").write_text("")
        fake_cli = self.tmp / "codewatch"
        fake_cli.write_text(f"#!{sys.executable}\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n")
        fake_cli.chmod(0o755)
        enable(self.home, self.workspace, PLUGIN)
        server = self.user_config()["mcpServers"][SERVER_NAME]

        env = {"PATH": os.environ["PATH"], "CODEWATCH_BIN": str(fake_cli), **server["env"]}
        done = subprocess.run([server["command"], *server["args"]], cwd=self.workspace, env=env,
                              capture_output=True, text=True, timeout=30, check=False)

        self.assertEqual(done.returncode, 0, done.stderr)
        db = str(self.workspace / ".codewatch" / "graph.db")
        self.assertEqual(json.loads(done.stdout), ["graph", "mcp", "--db", db, "--repo-root", str(self.workspace)])


class ImageTest(unittest.TestCase):
    def test_the_image_carries_the_plugin_and_enables_nothing_by_itself(self):
        dockerfile = (BENCH / "image" / "Dockerfile").read_text()

        self.assertIn("COPY plugin /opt/codewatch-a1/plugin", dockerfile)
        self.assertIn("COPY inject /opt/codewatch-a1/inject", dockerfile)
        for marker in (".claude", "enabledPlugins", "mcpServers", "settings.json"):
            self.assertNotIn(marker, dockerfile)


if __name__ == "__main__":
    unittest.main()
