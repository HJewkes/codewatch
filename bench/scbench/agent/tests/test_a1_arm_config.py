"""The committed A1 arm config: claude_code_cw.yaml with every stage on, and nothing else changed."""

import unittest
from pathlib import Path

from agent.tests.test_claude_code_cw import FakeRuntime, SolveCapture, _build, _solve

import yaml
from slop_code.agent_runner.registry import build_agent_config

from agent.stages import STAGE_NAMES

AGENT_DIR = Path(__file__).resolve().parents[1]
BASE = yaml.safe_load((AGENT_DIR / "claude_code_cw.yaml").read_text())
A1 = yaml.safe_load((AGENT_DIR / "claude_code_cw.a1.yaml").read_text())


class A1ArmConfigTest(unittest.TestCase):
    def test_the_a1_config_is_the_base_config_with_only_enabled_flags_changed(self):
        stages_off = {name: {**stage, "enabled": False} for name, stage in A1["stages"].items()}

        self.assertEqual({**A1, "stages": stages_off}, BASE)

    def test_the_a1_config_enables_all_nine_stages_and_validates(self):
        config = build_agent_config(A1)

        self.assertEqual(len(STAGE_NAMES), 9)
        self.assertEqual(sorted(config.stages), sorted(STAGE_NAMES))
        self.assertEqual([n for n, s in config.stages.items() if not (s.enabled and s.command)], [])

    def test_every_a1_stage_command_runs_over_two_checkpoints(self):
        runtime = FakeRuntime()
        agent = _build(build_agent_config(A1), runtime)

        _solve(agent, SolveCapture(), checkpoints=2)

        streamed = {command for command, _ in runtime.streamed}
        self.assertEqual({n for n in STAGE_NAMES if A1["stages"][n]["command"] not in streamed}, set())
        cp2 = {record.stage: record.status for record in agent.stage_records}
        self.assertEqual(cp2, {name: "ok" for name in STAGE_NAMES if name != "repo-init"})


if __name__ == "__main__":
    unittest.main()
