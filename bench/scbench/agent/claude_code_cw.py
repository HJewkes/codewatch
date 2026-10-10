"""`claude_code_cw`: the stock `claude_code` agent plus codewatch stages (arm A1).

The solve session is the parent's `run()`, untouched, so with every stage off the
claude argv and prompt bytes equal stock `claude_code`. Stages run inside
`run_checkpoint()`, in the checkpoint's container. The runner snapshots the workspace
and grades only after `run_checkpoint()` returns (see README.md).
"""

from __future__ import annotations

import time
import typing as tp
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator
from slop_code.agent_runner.agent import AgentConfigBase, CheckpointInferenceResult
from slop_code.agent_runner.agents.claude_code.agent import (
    ClaudeCodeAgent,
    ClaudeCodeConfig,
)
from slop_code.agent_runner.registry import register_agent

from .stages import (
    DEFAULT_CAP_SECONDS,
    DEFAULT_RESERVE_SECONDS,
    STAGE_NAMES,
    ExecResult,
    StageBudget,
    StageRecord,
    StageRunner,
    StageSetting,
    stages_for,
    write_stages_json,
)

STAGES_FILENAME = "stages.json"


class StageConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    command: str | None = None


class ClaudeCodeCwConfig(ClaudeCodeConfig, agent_type="claude_code_cw"):
    type: tp.Literal["claude_code_cw"] = "claude_code_cw"  # type: ignore[assignment]
    stages: dict[str, StageConfig] = Field(default_factory=dict)
    stage_budget_s: float | None = None
    checkpoint_cap_s: float = DEFAULT_CAP_SECONDS
    stage_reserve_s: float = DEFAULT_RESERVE_SECONDS

    @field_validator("stages")
    @classmethod
    def _known_stages(cls, value: dict[str, StageConfig]) -> dict[str, StageConfig]:
        unknown = sorted(set(value) - set(STAGE_NAMES))
        if unknown:
            raise ValueError(f"unknown stages {unknown}; known: {list(STAGE_NAMES)}")
        return value


class ClaudeCodeCwAgent(ClaudeCodeAgent):
    clock: tp.ClassVar[tp.Callable[[], float]] = staticmethod(time.time)

    def __init__(self, *args: tp.Any, **kwargs: tp.Any) -> None:
        super().__init__(*args, **kwargs)
        self.stage_settings: dict[str, StageSetting] = {}
        self.budget_args: dict[str, float | None] = {}
        self.checkpoint_index = 0
        self.stage_records: list[StageRecord] = []
        self.mcp_tool_calls = 0

    @classmethod
    def _from_config(cls, config: AgentConfigBase, *args: tp.Any, **kwargs: tp.Any):
        if not isinstance(config, ClaudeCodeCwConfig):
            raise TypeError(f"Expected ClaudeCodeCwConfig, got {type(config).__name__}")
        agent = super()._from_config(config, *args, **kwargs)
        agent.stage_settings = {
            name: StageSetting(enabled=s.enabled, command=s.command)
            for name, s in config.stages.items()
        }
        agent.budget_args = {
            "stage_seconds": config.stage_budget_s,
            "cap_seconds": config.checkpoint_cap_s,
            "reserve_seconds": config.stage_reserve_s,
        }
        return agent

    def run_checkpoint(self, task: str) -> CheckpointInferenceResult:
        self.checkpoint_index += 1
        budget = StageBudget(checkpoint_start=self.clock(), **self.budget_args)
        runner = StageRunner(
            self.stage_settings, budget, self._exec_stage, self.clock, self.log.warning
        )
        env = self._stage_env()
        steps_before = len(self.steps)
        runner.run(stages_for(self.checkpoint_index, before_solve=True), env)
        result = super().run_checkpoint(task)
        runner.run(stages_for(self.checkpoint_index, before_solve=False), env)
        self.stage_records = runner.records
        self.mcp_tool_calls = count_mcp_tool_calls(self.steps[steps_before:])
        return result

    def _stage_env(self) -> dict[str, str]:
        env = {key: str(value) for key, value in self.env.items()}
        env.update(self._build_runtime_auth_env())
        # The solve sets this too; without it Claude Code makes haiku side calls in a stage.
        env["DISABLE_NON_ESSENTIAL_MODEL_CALLS"] = "1"
        env["CW_CHECKPOINT"] = str(self.checkpoint_index)
        env["CW_CLAUDE_BINARY"] = self.binary
        env["CW_MODEL"] = self.model
        if self.permission_mode:
            env["CW_PERMISSION_MODE"] = self.permission_mode
        return env

    def _exec_stage(self, command: str, env: tp.Mapping[str, str], timeout: float) -> ExecResult:
        for event in self.runtime.stream(command=command, env=dict(env), timeout=timeout):
            if event.kind == "finished" and event.result is not None:
                r = event.result
                return ExecResult(exit_code=r.exit_code, stdout=r.stdout or "", timed_out=r.timed_out)
        return ExecResult(exit_code=None, stdout="", timed_out=False)

    def save_artifacts(self, path: Path) -> None:
        super().save_artifacts(path)
        write_stages_json(
            path / STAGES_FILENAME, self.checkpoint_index, self.stage_records, self.mcp_tool_calls
        )


def count_mcp_tool_calls(payloads: list[dict[str, tp.Any]]) -> int:
    calls = 0
    for payload in payloads:
        message = payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        calls += sum(
            1
            for item in content
            if isinstance(item, dict)
            and item.get("type") == "tool_use"
            and str(item.get("name", "")).startswith("mcp__")
        )
    return calls


register_agent("claude_code_cw", ClaudeCodeCwAgent)
