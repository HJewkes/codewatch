import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    import slop_code  # noqa: F401
except ModuleNotFoundError:
    raise unittest.SkipTest("slop-code-bench is not installed; run pnpm test:bench:agent")

import yaml
from slop_code.agent_runner.agent import Agent
from slop_code.agent_runner.agents.claude_code import ClaudeCodeConfig
from slop_code.agent_runner.agents.claude_code.agent import ClaudeCodeAgent
from slop_code.agent_runner.credentials import CredentialType, ProviderCredential
from slop_code.agent_runner.registry import build_agent_config, get_agent_cls
from slop_code.agent_runner.runner import get_task_for_checkpoint
from slop_code.common.llms import APIPricing, ModelDefinition
from slop_code.execution import DockerConfig, DockerEnvironmentSpec
from slop_code.execution.runtime import RuntimeEvent, RuntimeResult

from agent.claude_code_cw import ClaudeCodeCwAgent, ClaudeCodeCwConfig, count_mcp_tool_calls
from agent.stages import STAGE_NAMES

STOCK_FIELDS = {
    "binary": "claude",
    "permission_mode": "bypassPermissions",
    "version": "2.0.51",
    "cost_limits": {"cost_limit": 0, "step_limit": 100, "net_cost_limit": 0},
    "append_system_prompt": "Be terse.",
    "allowed_tools": ["Bash", "Edit"],
}
TASK = "Implement checkpoint 2.\nKeep NOTES.md current; write tests under tests/. It's 'quoted' $HOME `x`\n"


def _result(exit_code=0, stdout=""):
    return RuntimeResult(exit_code=exit_code, stdout=stdout, stderr="", setup_stdout="",
                         setup_stderr="", elapsed=0.0, timed_out=False)


class FakeRuntime:
    def __init__(self, stage_results=None):
        self.streamed = []
        self.stage_results = stage_results or {}

    def stream(self, command, env, timeout):
        self.streamed.append((command, dict(env)))
        result = self.stage_results.get(command, _result())
        if isinstance(result, Exception):
            raise result
        yield RuntimeEvent(kind="finished", result=result)


class SolveCapture:
    """Replaces the CLI stream so no claude process starts."""

    def __init__(self, payloads=()):
        self.calls = []
        self.payloads = payloads

    def __call__(self, *, command, env, **_):
        self.calls.append((command, dict(env)))
        for payload in self.payloads:
            yield (None, None, payload)
        yield _result()


def _model():
    return ModelDefinition(internal_name="sonnet-test", provider="anthropic",
                           pricing=APIPricing(input=3, output=15, cache_read=0.3, cache_write=3.75))


def _credential():
    return ProviderCredential(provider="anthropic", value="fake-token", source="CLAUDE_CODE_OAUTH_TOKEN",
                              destination_key="CLAUDE_CODE_OAUTH_TOKEN", credential_type=CredentialType.ENV_VAR)


def _build(config, runtime):
    agent = Agent.from_config(config, _model(), _credential(), "problem", False, "image", "high")
    agent._runtime = runtime
    agent._workspace = Path("/workspace")
    agent._environment = DockerEnvironmentSpec(name="env", docker=DockerConfig(image="python:3.12"))
    return agent


def _solve(agent, capture, checkpoints=1):
    target = "slop_code.agent_runner.agents.claude_code.agent.stream_cli_command"
    with mock.patch(target, capture), mock.patch.object(type(agent), "_prepare_runtime_execution",
                                                        autospec=True, side_effect=_record_task):
        results = []
        for _ in range(checkpoints):
            results.append(agent.run_checkpoint(TASK))
            agent.finish_checkpoint()
    return results


PROMPTS: list[bytes] = []
_STOCK_PREPARE = ClaudeCodeAgent._prepare_runtime_execution


def _record_task(self, task, **kwargs):
    PROMPTS.append(task.encode())
    return _STOCK_PREPARE(self, task, **kwargs)


def _cw_config(stages):
    return ClaudeCodeCwConfig(type="claude_code_cw", stages=stages, **STOCK_FIELDS)


class RegistrationTest(unittest.TestCase):
    def test_runner_resolves_claude_code_cw_from_a_config_dict(self):
        config = build_agent_config({"type": "claude_code_cw", **STOCK_FIELDS})

        self.assertIsInstance(config, ClaudeCodeCwConfig)
        self.assertIs(get_agent_cls("claude_code_cw"), ClaudeCodeCwAgent)
        self.assertEqual(get_agent_cls("claude_code").__name__, "ClaudeCodeAgent")

    def test_the_shipped_config_validates_with_every_stage_off(self):
        raw = yaml.safe_load((Path(__file__).parents[1] / "claude_code_cw.yaml").read_text())

        config = build_agent_config(raw)

        self.assertEqual(sorted(config.stages), sorted(STAGE_NAMES))
        self.assertFalse(any(s.enabled for s in config.stages.values()))

    def test_unknown_stage_names_are_rejected(self):
        with self.assertRaises(ValueError):
            _cw_config({"lint": {"enabled": True}})


class StockEquivalenceTest(unittest.TestCase):
    def test_with_every_stage_off_claude_argv_env_and_prompt_bytes_equal_stock(self):
        stock_runtime, cw_runtime = FakeRuntime(), FakeRuntime()
        stock_capture, cw_capture = SolveCapture(), SolveCapture()
        stock = _build(ClaudeCodeConfig(type="claude_code", **STOCK_FIELDS), stock_runtime)
        cw = _build(_cw_config({name: {"enabled": False, "command": "x"} for name in STAGE_NAMES}), cw_runtime)

        PROMPTS.clear()
        _solve(stock, stock_capture, checkpoints=2)
        stock_prompts = list(PROMPTS)
        PROMPTS.clear()
        _solve(cw, cw_capture, checkpoints=2)

        self.assertEqual(len(cw_capture.calls), 2)
        self.assertIn("--append-system-prompt", cw_capture.calls[0][0])
        self.assertEqual(cw_capture.calls, stock_capture.calls)
        self.assertEqual(PROMPTS, stock_prompts)
        self.assertEqual(PROMPTS[0], TASK.encode())
        self.assertEqual(cw_runtime.streamed, stock_runtime.streamed)

    def test_the_rendered_prompt_does_not_depend_on_the_agent_type(self):
        env = DockerEnvironmentSpec(name="env", docker=DockerConfig(image="python:3.12"))
        template = "{% if is_continuation %}Continue.{% endif %}\n{{ spec }}\nRun: {{ entry_command }}\n"
        with tempfile.TemporaryDirectory() as tmp:
            prompts = [
                get_task_for_checkpoint("checkpoint_2", "Add --json.", template, "main.py", env,
                                        is_first_checkpoint=False, output_path=Path(tmp), agent_type=kind)
                for kind in ("claude_code", "claude_code_cw")
            ]
        self.assertEqual(prompts[0].encode(), prompts[1].encode())


class StageHookTest(unittest.TestCase):
    def test_stages_run_around_the_solve_and_failures_do_not_end_the_checkpoint(self):
        runtime = FakeRuntime({"cw-index": RuntimeError("container hiccup"),
                               "cw-audit": _result(stdout='{"items_out": 42}')})
        stages = {"inject": {"enabled": True, "command": "cw-inject"},
                  "index": {"enabled": True, "command": "cw-index"},
                  "audit": {"enabled": True, "command": "cw-audit"},
                  "triage": {"enabled": True}}
        agent = _build(_cw_config(stages), runtime)

        results = _solve(agent, SolveCapture(), checkpoints=2)
        with tempfile.TemporaryDirectory() as tmp:
            agent.save_artifacts(Path(tmp))
            raw = json.loads((Path(tmp) / "stages.json").read_text())

        self.assertFalse(any(r.had_error for r in results))
        stage_commands = [c for c, _ in runtime.streamed if c.startswith("cw-")]
        self.assertEqual(stage_commands, ["cw-index", "cw-audit", "cw-inject", "cw-index", "cw-audit"])
        by_stage = {row["stage"]: row for row in raw["stages"]}
        self.assertEqual(raw["checkpoint"], 2)
        self.assertEqual(by_stage["inject"]["exit"], 0)
        self.assertEqual(by_stage["index"]["status"], "failed")
        self.assertEqual(by_stage["audit"]["items_out"], 42)
        self.assertEqual(by_stage["triage"]["status"], "missing")
        self.assertEqual(by_stage["remediation"]["status"], "disabled")
        self.assertEqual(dict(runtime.streamed[-1][1])["CW_CHECKPOINT"], "2")

    def test_mcp_tool_calls_count_only_this_checkpoints_mcp_tool_uses(self):
        payloads = [{"message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "mcp__codewatch__get_overview"},
            {"type": "tool_use", "name": "Bash"}]}},
            {"message": "plain string"}]
        agent = _build(_cw_config({}), FakeRuntime())

        _solve(agent, SolveCapture(payloads), checkpoints=2)

        self.assertEqual(agent.mcp_tool_calls, 1)
        self.assertEqual(count_mcp_tool_calls(payloads * 2), 2)


if __name__ == "__main__":
    unittest.main()
