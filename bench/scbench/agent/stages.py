"""Stage plan, time budget and `stages.json` records for the A1 stage-hook agent.

Standard library only, so it is testable without slop-code-bench installed. The agent
in `claude_code_cw.py` supplies the executor that runs a command inside the
checkpoint's container.

Each stage runs one pluggable shell command. The command may print a JSON object as its
last stdout line to report `tokens`, `usd`, `items_in`, `items_out` and any of
`PASSTHROUGH_FIELDS`. A stage with no command is a no-op recorded as `missing`.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

BEFORE_SOLVE = ("inject",)
AFTER_SOLVE = ("index", "audit", "replay", "triage", "remediation", "synthesis")
STAGE_NAMES = BEFORE_SOLVE + AFTER_SOLVE
FIRST_INJECT_CHECKPOINT = 2

METRIC_FIELDS = ("tokens", "usd", "items_in", "items_out")
PASSTHROUGH_FIELDS = ("outcome", "fixed_replay_diffs", "added_symbols")


@dataclass(frozen=True)
class StageSetting:
    enabled: bool = False
    command: str | None = None


@dataclass(frozen=True)
class ExecResult:
    exit_code: int | None
    stdout: str
    timed_out: bool


Executor = Callable[[str, Mapping[str, str], float], ExecResult]
Clock = Callable[[], float]


@dataclass(frozen=True)
class StageBudget:
    """Stops launching stages after `stage_seconds` of stage time, or once less than
    `reserve_seconds` remain under the `cap_seconds` checkpoint cap."""

    checkpoint_start: float
    stage_seconds: float = 25 * 60
    cap_seconds: float = 2 * 60 * 60
    reserve_seconds: float = 20 * 60

    def launch_deadline(self) -> float:
        return self.checkpoint_start + self.cap_seconds - self.reserve_seconds

    def may_launch(self, now: float, spent: float) -> bool:
        return spent < self.stage_seconds and now < self.launch_deadline()

    def timeout(self, now: float) -> float:
        return max(self.launch_deadline() - now, 0.0)


@dataclass
class StageRecord:
    stage: str
    status: str
    start: str | None = None
    end: str | None = None
    exit: int | None = None
    tokens: int = 0
    usd: float = 0.0
    items_in: int = 0
    items_out: int = 0
    extra: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        row = asdict(self)
        return {**{k: v for k, v in row.items() if k != "extra"}, **row["extra"]}


def stages_for(checkpoint: int, before_solve: bool) -> tuple[str, ...]:
    if not before_solve:
        return AFTER_SOLVE
    return BEFORE_SOLVE if checkpoint >= FIRST_INJECT_CHECKPOINT else ()


class StageRunner:
    """Runs the stages of one checkpoint, never raising on a stage failure."""

    def __init__(
        self,
        settings: Mapping[str, StageSetting],
        budget: StageBudget,
        executor: Executor,
        clock: Clock,
        log: Callable[..., None],
    ) -> None:
        self.settings = settings
        self.budget = budget
        self.executor = executor
        self.clock = clock
        self.log = log
        self.records: list[StageRecord] = []
        self.spent = 0.0

    def run(self, names: tuple[str, ...], env: Mapping[str, str]) -> None:
        for name in names:
            self.records.append(self._run_one(name, env))

    def _run_one(self, name: str, env: Mapping[str, str]) -> StageRecord:
        setting = self.settings.get(name, StageSetting())
        if not setting.enabled:
            return StageRecord(stage=name, status="disabled")
        if not setting.command:
            return StageRecord(stage=name, status="missing")
        now = self.clock()
        if not self.budget.may_launch(now, self.spent):
            return StageRecord(stage=name, status="skipped_budget")
        record = StageRecord(stage=name, status="ok", start=_iso(now))
        try:
            result = self.executor(
                setting.command, {**env, "CW_STAGE": name}, self.budget.timeout(now)
            )
            _apply_result(record, result)
        except Exception as error:  # noqa: BLE001 - a stage must never end the checkpoint
            record.status = "failed"
            record.extra["error"] = f"{type(error).__name__}: {error}"
        end = self.clock()
        self.spent += end - now
        record.end = _iso(end)
        if record.status != "ok":
            self.log("agent.claude_code_cw.stage_failed", stage=name, status=record.status)
        return record


def _apply_result(record: StageRecord, result: ExecResult) -> None:
    record.exit = result.exit_code
    if result.timed_out:
        record.status = "timeout"
    elif result.exit_code != 0:
        record.status = "failed"
    report = _last_json_line(result.stdout)
    for key in METRIC_FIELDS:
        if isinstance(report.get(key), int | float):
            setattr(record, key, type(getattr(record, key))(report[key]))
    record.extra.update({k: report[k] for k in PASSTHROUGH_FIELDS if k in report})


def _last_json_line(stdout: str) -> dict:
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        return {}
    try:
        parsed = json.loads(lines[-1])
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat()


def write_stages_json(
    path: Path,
    checkpoint: int,
    records: list[StageRecord],
    mcp_tool_calls: int,
) -> None:
    payload = {
        "checkpoint": checkpoint,
        "stages": [r.to_json() for r in records],
        "mcp_tool_calls": mcp_tool_calls,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")
