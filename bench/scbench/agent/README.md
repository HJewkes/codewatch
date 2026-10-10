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

`python -m agent` runs `bootstrap.setup()` before any command. The runner runs each
problem in a spawned worker, and spawn never re-runs `agent/__main__.py`. So `setup()`
also makes itself the initializer of every `ProcessPoolExecutor`, and each worker
runs it before its first task. A pool's own initializer runs after it. If `setup()`
fails in a worker, the pool breaks and no task runs there. `setup()` registers
`claude_code_cw` and does the three steps below. Never launch with a bare
`slop-code run`, which skips all of this.

- **Catalogs.** The runner's wheel ships no `configs/`, so its model and provider
  catalogs would load empty. `runner_configs.preload()` loads models from the runner
  checkout's `configs/models` (`$SCBENCH_RUNNER_CONFIGS`, default
  `~/.cache/bs-30/slop-code-bench/configs`), then the vendored
  `bench/scbench/configs/models` on top. `providers.yaml` comes from the checkout.
  Agent, environment and prompt configs are passed as paths. `record_manifest.py`
  records the dirs used and the sha256 of each vendored config under `runnerConfigs`.
- **Tokens by name.** The runner passes env to `docker exec` as `--env KEY=VALUE`, which
  would put a token on the host's process list. `secret_env.install()` passes
  credential-like keys as `--env KEY` and gives their values to the docker client
  through its env. A key is credential-like if it is on an explicit list, or if it
  contains one of the runner's own log-mask markers: token, secret, key, password,
  credential or authorization. The runner's two exemptions, `MAX_THINKING_TOKENS` and
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, keep their values. The container env and the claude
  argv are unchanged. If the runner's docker runtime lacks the hooks this replaces,
  `install()` aborts.
- **No run dir in a checkout.** `output_guard.install()` stops `slop-code run` before it
  creates or reads a run dir inside any repo checkout, for a fresh run and for
  `--resume`. Pass `save_dir=` and `save_template=`, because the runner ignores
  `output_path=`.

Vendored configs in `bench/scbench/configs/`:

- `models/sonnet-5.5.yaml`: the runner at `31ceea3` has no 5.5 model. Its prices are
  assumed, for cost accounting only.
- `environments/docker-python3.12-uv-rootless.yaml`: the BS-30 rootless env plus
  `IS_SANDBOX=1`, used by all three arms. Its snapshot ignore list is the runner's
  default plus `.codewatch/*`, so nothing A1 keeps there is graded. See the validity
  notes in `../README.md`.

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
image and ends the checkpoint's PR. It ratchets the PR head against its merge-base again
(`graph check --baseline cw-merge-base-cp-N`, `graph diff --footprint` between the two
snapshots), then writes:

- `.codewatch/taste.d/cp-N.md`: one Sonnet 5.5 call, at most 300 words. Each line cites a
  verdict and ends in `{inferred cpN fp:<finding key>}`; a line citing none is dropped.
- `.codewatch/session-brief.json`: new violations and the most-imported changed symbols.
  It is derived and never committed.
- `.codewatch/audit/pr-report.json`: a `codewatch-pr-report@1`-shaped report (check,
  deltas, at most 3 questions).

It then merges `cp-N` into `main` with the report's markdown as the commit message. The
codewatch plugin's SessionStart hook appends the taste and verdict heads plus unmerged
fragments, and the brief, to its snapshot.

On `main`, synthesis then acts as the merging job (`synthesis/fold_job.py`). It folds
`taste.d/*.md` into `taste.md` and `verdicts.d/*.jsonl` into `verdicts.jsonl`, in id order
(`cp-2` before `cp-10`), and deletes the absorbed fragments in one commit. An
`{owner ...}` taste line is never edited or removed, and an inferred line replaces the
earlier one with the same finding key. For verdicts the latest row per key wins, and a
key whose anchor symbol is not in the head snapshot's node table is dropped; when that
table cannot be read, nothing is dropped. A malformed fragment stays in place and is
listed under `fold.malformed` in `stages.json`. With nothing to absorb there is no commit,
so a second run is a no-op.

On `@codewatch/cli` 0.7.0, which has no `graph index --rev`, there is no merge-base
snapshot, so every violation counts as new and the changed-symbol list stays empty.

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
`reason`, `fixed_replay_diffs`, `added_symbols`, `branch`, `solve_commit`, `merge_base`,
`baseline`, `session_id`, `turns`, `held_back`, `items`, `stopped_by`, `merge` and
`merge_commit`.

**Stage env.** Besides the solve's env and credential, a stage gets `CW_STAGE`,
`CW_CHECKPOINT`, `CW_STAGE_DEADLINE` (the epoch second at which the stage is cut off) and
the solve's `CW_CLAUDE_BINARY`, `CW_MODEL` and `CW_PERMISSION_MODE`, so a stage's claude
session runs like the solve's and can stop cleanly before it is cut off.

**PR flow.** `repo-init`, `pr-open` and `commit-ratchet` run `bench/scbench/prflow` from
the image: one checkpoint is one PR on a hidden repository at `.codewatch/repo.git`. See
`../README.md`, "prflow/".

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
