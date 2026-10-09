# claude_code_cw: the A1 stage-hook agent

`claude_code_cw` is the stock slop-code-bench `claude_code` agent plus codewatch stages
(design unit U2). The solve session is the parent's `run()`, unchanged. Stages run in
`run_checkpoint()`, in the checkpoint's container, before control returns to the runner.

```
cd bench/scbench
uv run --project agent python -m agent run --agent agent/claude_code_cw.yaml ...
```

`python -m agent` is the `slop-code` CLI with `claude_code_cw` registered.
slop-code-bench is pinned by commit in `pyproject.toml`, because the runner has no
release past v0.3. `uv.lock` pins its dependencies. Run A0 and A1a through the same
launcher, with `type: claude_code`, so all three arms share one dependency set.

## Launcher setup

`python -m agent` does two things before any command runs, in every worker process:

- **Catalogs.** The runner's wheel ships no `configs/`, so its model and provider
  catalogs would load empty. `runner_configs.preload()` loads models from the runner
  checkout's `configs/models` (`$SCBENCH_RUNNER_CONFIGS`, default
  `~/.cache/bs-30/slop-code-bench/configs`), then the vendored
  `bench/scbench/configs/models` on top. `providers.yaml` comes from the checkout.
  Agent, environment and prompt configs are passed as paths. `record_manifest.py`
  records the dirs used and the sha256 of each vendored model under `runnerConfigs`.
- **Tokens by name.** The runner passes env to `docker exec` as `--env KEY=VALUE`, which
  would put a token on the host's process list. `secret_env.install()` passes
  credential-like keys (`*_TOKEN`, `*_API_KEY`, `*_SECRET`, `*_PASSWORD`) as `--env KEY`
  and gives their values to the docker client through its env. The container env and
  the claude argv are unchanged.

The vendored `sonnet-5.5.yaml` exists because the runner at `31ceea3` has no 5.5
model. Its prices are assumed, for cost accounting only.

## Stages

| When | Stages |
|---|---|
| Before the solve, checkpoint 2 on | `inject` |
| After the solve, every checkpoint | `index`, `audit`, `replay`, `triage`, `remediation`, `synthesis` |

Each stage has an `enabled` flag and a `command`, which runs in the container with
`CW_STAGE` and `CW_CHECKPOINT` set. Stages are off by default. Each stage's status is
recorded as one of:

- `disabled`: the stage is off.
- `missing`: the stage is on but has no command (a unit not built yet).
- `ok`, `failed` or `timeout`: the command ran.
- `skipped_budget`: the budget stopped it.

A failure is logged and the next stage still runs.

The agent counts checkpoints itself, so after a `--resume` the count restarts at 1.
The agent also cannot tell which checkpoint is the last one, so `synthesis` runs on every
checkpoint, including the final one. Its output only feeds the next checkpoint's
injection.

**Budget.** No stage launches after 25 minutes of stage time in a checkpoint, or once
fewer than 20 minutes remain under the 2-hour checkpoint cap. A launched stage times out
at that 20-minute line. All three values are config fields.

**Report line.** A stage command may print a JSON object as its last stdout line. These
keys are copied into `stages.json`: `tokens`, `usd`, `items_in`, `items_out`, `outcome`,
`fixed_replay_diffs` and `added_symbols`.

## stages.json

The agent writes `stages.json` into the checkpoint's agent artifacts directory
(`checkpoint_<n>/agent/`, or inside the tarball when artifacts are compressed).

```
{"checkpoint": 2, "mcp_tool_calls": 3,
 "stages": [{"stage": "audit", "status": "ok", "start": "...", "end": "...", "exit": 0,
             "tokens": 0, "usd": 0.0, "items_in": 0, "items_out": 42}]}
```

`mcp_tool_calls` counts `mcp__*` tool uses in this checkpoint's solve session.

## Grading happens after the stages

At commit `31ceea3`, in `src/slop_code/agent_runner/runner.py`:

1. `_run_inference` calls `agent.run_checkpoint(task)` (line 362, via line 290).
2. Its `finally` block snapshots the workspace with `session.finish_checkpoint(snapshot_dir)`
   (line 392). This happens only after `run_checkpoint` has returned.
3. `AgentRunner._run_checkpoint` grades that snapshot with `evaluate_agent_snapshot`
   (line 818), after `run_checkpoint(...)` has returned (line 728).
4. `save_artifacts` runs through `reporting.save_agent_checkpoint_info` (line 744).

So every stage's workspace edits are in the graded snapshot. Nothing a stage does can
see the grade.

## Tests

`pnpm test:bench` runs everything that needs only the standard library. It skips the
agent tests when slop-code-bench is not installed. `pnpm test:bench:agent` runs the
agent tests under uv, including the diff of claude argv, env and prompt bytes against
stock `claude_code`. CI runs both. No test starts claude or Docker.
