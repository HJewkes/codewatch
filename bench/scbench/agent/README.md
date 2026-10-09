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

## Stages

| When | Stages |
|---|---|
| Before the solve, checkpoint 1 | `repo-init` |
| Before the solve, every checkpoint | `pr-open` |
| Before the solve, checkpoint 2 on | `inject` |
| After the solve, every checkpoint | `commit-ratchet`, `audit`, `triage`, `solve-review`, `fix`, `synthesis` |

Stages run in the order listed. `repo-init` runs whenever the agent's own count is 1,
which is also the first checkpoint after a `--resume`, so its command must be idempotent.

Each stage has an `enabled` flag and a `command`, which runs in the container with
`CW_STAGE`, `CW_CHECKPOINT` and `CW_STAGE_DEADLINE` (the launch deadline, in epoch
seconds) set. Stages are off by default. Each stage's status is
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

The `synthesis` command in `claude_code_cw.yaml` runs `bench/scbench/synthesis` from the
image. It writes `.codewatch/rubric.md` (one Sonnet 5.5 call, at most 300 words) and
`.codewatch/session-brief.json` (at most 3 open items and the most-imported changed
symbols), which the codewatch plugin's SessionStart hook appends to its snapshot. The
changed symbols need `graph diff --footprint`, which is newer than `@codewatch/cli` 0.7.0;
on 0.7.0 that list stays empty.

**Budget.** Caps are opt-in, never defaults. With `stage_budget_s` unset, stages stop
launching only once fewer than `stage_reserve_s` (default 180 s) remain under
`checkpoint_cap_s` (default 2 hours). A launched stage times out at that line, and a long
stage reads `CW_STAGE_DEADLINE` to stop starting new items before it. Setting
`stage_budget_s` adds a cap on total stage time per checkpoint.

The reserve covers the consistency reset only: `git reset --hard` to the last kept commit
plus `git clean` of the work tree. Measured locally with a separate `GIT_DIR`, that took
0.04 s on 2,000 tracked files with 300 edited or added, and a 20,000-file ignored
`.venv`. The 3-minute default is the design's target; it leaves room for killing the timed-out
stage and the container exec. A separate `GIT_DIR` inside the work tree is not ignored
the way `.git` is, so it must be listed in `info/exclude`.

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
