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
from slop_code.entrypoints.config.loader import resolve_environment
from slop_code.execution import DockerConfig, DockerEnvironmentSpec
from slop_code.execution.models import SnapshotConfig
from slop_code.execution.runtime import RuntimeEvent, RuntimeResult
from slop_code.execution.snapshot import Snapshot

from agent.claude_code_cw import ClaudeCodeCwAgent, ClaudeCodeCwConfig, count_mcp_tool_calls
from agent.stages import STAGE_NAMES

PR_FLOW = ("repo-init", "pr-open", "commit-ratchet")

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


PILOT_ENV = Path(__file__).parents[2] / "configs" / "environments" / "docker-python3.12-uv-rootless.yaml"


def _build(config, runtime, environment=None):
    agent = Agent.from_config(config, _model(), _credential(), "problem", False, "image", "high")
    agent._runtime = runtime
    agent._workspace = Path("/workspace")
    agent._environment = environment or DockerEnvironmentSpec(name="env", docker=DockerConfig(image="python:3.12"))
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
        self.assertIsNone(config.stage_budget_s)
        self.assertEqual((config.checkpoint_cap_s, config.stage_reserve_s), (7200, 180))

    def test_stage_budget_has_no_default_and_is_an_opt_in_cap(self):
        unset = _build(_cw_config({}), FakeRuntime())
        capped = _build(ClaudeCodeCwConfig(type="claude_code_cw", stage_budget_s=600, **STOCK_FIELDS),
                        FakeRuntime())

        self.assertIsNone(unset.budget_args["stage_seconds"])
        self.assertEqual(unset.budget_args["reserve_seconds"], 180)
        self.assertEqual(capped.budget_args["stage_seconds"], 600)

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

    def test_the_pilot_env_leaves_claude_argv_env_and_prompt_equal_to_stock(self):
        pilot = resolve_environment(PILOT_ENV)
        captures = []
        PROMPTS.clear()
        for config, env in [(ClaudeCodeConfig(type="claude_code", **STOCK_FIELDS), None),
                            (ClaudeCodeConfig(type="claude_code", **STOCK_FIELDS), pilot),
                            (_cw_config({}), pilot)]:
            capture = SolveCapture()
            _solve(_build(config, FakeRuntime(), env), capture)
            captures.append(capture.calls)

        self.assertEqual(captures[1], captures[0])
        self.assertEqual(captures[2], captures[0])
        self.assertEqual(PROMPTS, [TASK.encode()] * 3)
        self.assertNotIn("IS_SANDBOX", captures[0][0][1])
        self.assertEqual(pilot.get_full_env({})["IS_SANDBOX"], "1")
        self.assertEqual(pilot.docker.user, "0:0")

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
        runtime = FakeRuntime({"cw-ratchet": RuntimeError("container hiccup"),
                               "cw-audit": _result(stdout='{"items_out": 42}')})
        stages = {"repo-init": {"enabled": True, "command": "cw-init"},
                  "pr-open": {"enabled": True, "command": "cw-pr"},
                  "inject": {"enabled": True, "command": "cw-inject"},
                  "commit-ratchet": {"enabled": True, "command": "cw-ratchet"},
                  "audit": {"enabled": True, "command": "cw-audit"},
                  "triage": {"enabled": True}}
        agent = _build(_cw_config(stages), runtime)

        results = _solve(agent, SolveCapture(), checkpoints=2)
        with tempfile.TemporaryDirectory() as tmp:
            agent.save_artifacts(Path(tmp))
            raw = json.loads((Path(tmp) / "stages.json").read_text())

        self.assertFalse(any(r.had_error for r in results))
        stage_commands = [c for c, _ in runtime.streamed if c.startswith("cw-")]
        self.assertEqual(stage_commands, ["cw-init", "cw-pr", "cw-ratchet", "cw-audit",
                                          "cw-pr", "cw-inject", "cw-ratchet", "cw-audit"])
        by_stage = {row["stage"]: row for row in raw["stages"]}
        self.assertEqual(raw["checkpoint"], 2)
        self.assertNotIn("repo-init", by_stage)
        self.assertEqual(by_stage["inject"]["exit"], 0)
        self.assertEqual(by_stage["commit-ratchet"]["status"], "failed")
        self.assertEqual(by_stage["audit"]["items_out"], 42)
        self.assertEqual(by_stage["triage"]["status"], "missing")
        self.assertEqual(by_stage["fix"]["status"], "disabled")
        stage_env = dict(runtime.streamed[-1][1])
        self.assertEqual(stage_env["CW_CHECKPOINT"], "2")
        self.assertEqual((stage_env["CW_MODEL"], stage_env["CW_CLAUDE_BINARY"]), (agent.model, "claude"))
        self.assertEqual(stage_env["CW_PERMISSION_MODE"], "bypassPermissions")
        self.assertEqual(stage_env["CLAUDE_CODE_OAUTH_TOKEN"], "fake-token")

    def test_with_the_pr_flow_on_the_solve_session_gets_no_git_dir(self):
        shipped = yaml.safe_load((Path(__file__).parents[1] / "claude_code_cw.yaml").read_text())["stages"]
        flow = {name: {**shipped[name], "enabled": True} for name in PR_FLOW}
        runtime, capture = FakeRuntime(), SolveCapture()
        agent = _build(_cw_config(flow), runtime, resolve_environment(PILOT_ENV))

        _solve(agent, capture, checkpoints=2)

        ran = [c.split(" -m prflow ")[1].split()[0] for c, _ in runtime.streamed if " -m prflow " in c]
        self.assertEqual(ran, ["repo-init", "pr-open", "commit-ratchet", "pr-open", "commit-ratchet"])
        for _, solve_env in capture.calls:
            self.assertFalse({"GIT_DIR", "GIT_WORK_TREE"} & set(solve_env))
        for _, stage_env in runtime.streamed:
            self.assertNotIn("GIT_DIR", stage_env)

    def test_mcp_tool_calls_count_only_this_checkpoints_mcp_tool_uses(self):
        payloads = [{"message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "mcp__codewatch__get_overview"},
            {"type": "tool_use", "name": "Bash"}]}},
            {"message": "plain string"}]
        agent = _build(_cw_config({}), FakeRuntime())

        _solve(agent, SolveCapture(payloads), checkpoints=2)

        self.assertEqual(agent.mcp_tool_calls, 1)
        self.assertEqual(count_mcp_tool_calls(payloads * 2), 2)


class GradedSnapshotTest(unittest.TestCase):
    def test_the_pilot_snapshot_skips_codewatch_and_keeps_the_runner_defaults(self):
        pilot = resolve_environment(PILOT_ENV)
        files = ["main.py", "tests/test_main.py", "NOTES.md", ".codewatch/repo.git/HEAD",
                 ".codewatch/cache/graph.db", ".codewatch/taste.md", ".venv/bin/python"]
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            for rel in files:
                (workspace / rel).parent.mkdir(parents=True, exist_ok=True)
                (workspace / rel).write_text("x\n")
            snapshot = Snapshot.from_environment_spec(workspace, pilot)
            snapshot.cleanup()

        self.assertLessEqual(SnapshotConfig().ignore_globs | {".codewatch/*"}, pilot.get_ignore_globs())
        self.assertEqual(snapshot.matched_paths, {Path("main.py"), Path("tests/test_main.py"), Path("NOTES.md")})


if __name__ == "__main__":
    unittest.main()
