"""Only the A1 arm's inject stage turns on the codewatch plugin; every other arm's Claude config stays stock."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from agent.tests.test_claude_code_cw import STOCK_FIELDS, SolveCapture, _build, _cw_config, _result, _solve

import yaml
from slop_code.agent_runner.agents.claude_code import ClaudeCodeConfig
from slop_code.execution.runtime import RuntimeEvent

from agent.claude_code_cw import count_mcp_tool_calls
from agent.stages import STAGE_NAMES

BENCH = Path(__file__).resolve().parents[2]
PLUGIN = BENCH.parents[1] / "plugins" / "codewatch"
SHIPPED = yaml.safe_load((BENCH / "agent" / "claude_code_cw.yaml").read_text())["stages"]
PLUGIN_MARKERS = ("hooks", "mcpServers", "enabledPlugins", "extraKnownMarketplaces")


class HomeRuntime:
    """Runs each stage with /bin/sh in a scratch workspace and home, as `docker exec` would."""

    def __init__(self, workspace, home):
        self.workspace, self.home = workspace, home

    def stream(self, command, env, timeout):
        env = {**env, "PATH": os.environ["PATH"], "HOME": str(self.home)}
        done = subprocess.run(["/bin/sh", "-c", command], cwd=self.workspace, env=env,
                              capture_output=True, text=True, timeout=timeout, check=False)
        yield RuntimeEvent(kind="finished", result=_result(done.returncode, done.stdout))


def local_command(command, workspace):
    """The shipped command with the image's paths swapped for this checkout's."""
    return (command.replace("/workspace", str(workspace))
            .replace("/opt/codewatch-a1/plugin", str(PLUGIN))
            .replace("/opt/codewatch-a1/py/bin/python", sys.executable)
            .replace("/opt/codewatch-a1", str(BENCH)))


class ArmIsolationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def run_arm(self, name, config):
        """Two checkpoints with the runner's own mounted Claude home at `$HOME/.claude`."""
        workspace, home = self.tmp / name / "workspace", self.tmp / name / "home"
        workspace.mkdir(parents=True)
        home.mkdir()
        agent = _build(config, HomeRuntime(workspace, home))
        agent._workspace = workspace
        agent._tmp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(agent._tmp_dir.cleanup)
        agent._prepare_mounts()
        (home / ".claude").symlink_to(agent._settings_path.parent)
        capture = SolveCapture()
        _solve(agent, capture, checkpoints=2)
        return agent, home, capture.calls

    def assert_stock_claude_config(self, home):
        settings = json.loads((home / ".claude" / "settings.json").read_text())
        self.assertFalse(set(PLUGIN_MARKERS) & set(settings), settings)
        self.assertFalse((home / ".claude.json").exists())
        self.assertFalse((home / ".claude" / "plugins").exists())

    def test_only_the_a1_arm_gets_the_plugin_hook_and_mcp_server_and_its_solve_stays_stock(self):
        a1_stages = {"inject": {"enabled": True, "command": local_command(SHIPPED["inject"]["command"],
                                                                          self.tmp / "a1" / "workspace")}}
        every_stage_off = {name: {**SHIPPED[name], "enabled": False} for name in STAGE_NAMES}

        _, stock_home, stock_calls = self.run_arm("stock", ClaudeCodeConfig(type="claude_code", **STOCK_FIELDS))
        _, off_home, off_calls = self.run_arm("off", _cw_config(every_stage_off))
        a1, a1_home, a1_calls = self.run_arm("a1", _cw_config(a1_stages))

        self.assert_stock_claude_config(stock_home)
        self.assert_stock_claude_config(off_home)
        inject = next(r for r in a1.stage_records if r.stage == "inject")
        self.assertEqual((inject.status, inject.extra["outcome"]), ("ok", "enabled"))
        settings = json.loads((a1_home / ".claude" / "settings.json").read_text())
        [hook] = settings["hooks"]["SessionStart"][0]["hooks"]
        self.assertIn(str(PLUGIN / "hooks" / "session-start.mjs"), hook["command"])
        server = json.loads((a1_home / ".claude.json").read_text())["mcpServers"]["codewatch"]
        self.assertEqual(server["command"], str(PLUGIN / "bin" / "codewatch-launch.sh"))
        self.assertEqual(stock_calls, off_calls)
        self.assertEqual(a1_calls, stock_calls)

    def test_inject_waits_for_the_second_checkpoint(self):
        stages = {"inject": {"enabled": True, "command": local_command(SHIPPED["inject"]["command"],
                                                                       self.tmp / "one" / "workspace")}}
        workspace, home = self.tmp / "one" / "workspace", self.tmp / "one" / "home"
        workspace.mkdir(parents=True)
        home.mkdir()
        agent = _build(_cw_config(stages), HomeRuntime(workspace, home))

        _solve(agent, SolveCapture(), checkpoints=1)

        self.assertNotIn("inject", [r.stage for r in agent.stage_records])
        self.assertFalse((home / ".claude.json").exists())


class McpCountTest(unittest.TestCase):
    def test_mcp_tool_calls_count_the_codewatch_servers_tools_only(self):
        payloads = [{"message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "mcp__codewatch__get_context"},
            {"type": "tool_use", "name": "mcp__codewatch__find_similar"},
            {"type": "tool_use", "name": "mcp__ide__getDiagnostics"},
            {"type": "tool_use", "name": "Grep"}]}}]

        self.assertEqual(count_mcp_tool_calls(payloads), 2)


if __name__ == "__main__":
    unittest.main()
