# SCBench bench harness

Product-side harness for the SCBench pilot. The pilot compares three arms on the same
checkpoints, graded by the official `slop-code eval`:

- **A0**: stock Claude Code.
- **A1a**: A0 plus a handoff note and agent-written tests.
- **A1**: A1a plus codewatch stages.

The harness measures whether codewatch's stages (A1 minus A1a) improve code quality
without costing correctness.

## Rules

- **No benchmark content enters this repo.** Problem text, hidden tests and reference
  solutions stay out of it, as do eval outputs that quote them. Fixtures here are
  synthetic and written by hand.
- **Runs execute from a checkout under `~/projects/_bench/`.** The slop-code-bench runner
  and its problems live only there. This repo provides the harness code that the
  checkout calls. The runner has no release past v0.3, so it is pinned by commit
  (`31ceea3`).
- **The loop never sees the grader** (design section 3). No stage reads scb-check output,
  and the analysis never writes per-rule scb-check breakdowns.

## Running an arm

All three arms use the launcher in `agent/` and the vendored configs in `configs/`.
Always launch with `python -m agent`. Never use a bare `slop-code run`: it skips the
launcher setup, so the token would go on the `docker exec` argv, the model catalog
would be empty, and nothing would guard the run dir. Run from `bench/scbench`:

```
DOCKER_HOST=unix:///run/user/1000/docker.sock \
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/scbench/claude-oauth-token-server)" \
uv run --frozen --project agent python -m agent run \
  --agent <claude_code.yaml or agent/claude_code_cw.yaml> \
  --environment configs/environments/docker-python3.12-uv-rootless.yaml \
  --prompt <just-solve | a1a> --model claude_code_oauth/sonnet-5.5 --problem <name> \
  save_dir=~/.cache/codewatch-scbench/runs/<arm>/<UTC timestamp> save_template=run
```

The runner ignores `output_path=`. The launcher refuses a run dir inside any repo
checkout, and the runner's default `save_dir` (`outputs`) is one.

## Validity notes

- **The agent runs as container root.** Rootless Docker needs `user: "0:0"` so the
  agent can write the mounted workspace. The paper used a non-root user. The setup is the
  same for A0, A1a and A1.
- **`IS_SANDBOX=1`.** Claude Code 2.0.51 refuses `--dangerously-skip-permissions` as
  uid 0 unless `IS_SANDBOX` is set, so the pilot env sets it. The claude argv is
  unchanged. A side effect in the same CLI: under `IS_SANDBOX`, an API overloaded error
  (529) throws instead of retrying. So an overload can end a checkpoint's solve early.
  Report such checkpoints per arm. The env is the same for all three arms.

## tiert/

Test-shape checks for pytest functions: assertion-free, weak-oracle-only, duplicate
assert and self-compare, written as `findings.jsonl` rows. See `tiert/README.md`.

## analysis/

`analysis/` reads each arm's run directory after `slop-code eval`, plus A1's
per-checkpoint `stages.json`. That file is in `checkpoint_<n>/agent/`, or in
`agent.tar.gz` when artifacts are compressed; a missing one is an error. The script
writes the decision table as `report.md` and `report.json`. It contains:

- paired per-checkpoint deltas
- per-problem final checkpoints
- the adopt / iterate / drop verdict
- the gaming checks
- mechanism signals
- a sensitivity run of erosion and verbosity with the agent's tests directory excluded

```
cd bench/scbench
python3 -m analysis --a0 <A0 run dir> --a1a <A1a run dir> --a1 <A1 run dir> \
  --out <report dir> [--a0-replicate <A0' run dir>] [--tests-dir tests] \
  [--scratch ~/.cache/scbench-analysis] [--skip-sensitivity]
```

**Why Python:** `slop-code` and `scb-check` are Python tools run through `uv`, and their
output is JSON written by Python. The checkout under `~/projects/_bench/` already has
Python, so the script needs nothing installed. It uses only the standard library.

**Format.** Everything format-specific is in `analysis/inputs.py`. The format comes from
the runner's code at `31ceea3` and was checked against one real eval output:

- Solve counts come from each checkpoint's `evaluation.json` (`pass_counts`,
  `total_counts`).
- Cost comes from `inference_result.json`.
- Official erosion and verbosity come from the run's `checkpoint_results.jsonl`.

**Sensitivity run.** scb-check counts test files. So the script re-runs the same pinned
`uvx scb-check==0.1.3` on each checkpoint's `snapshot/`, once whole and once without the
tests directory, using a copy in `--scratch`. It reads only the report totals. The
report's parity gap compares the recorded scores with the whole-snapshot rerun. A gap
above about 0.001 means the rerun does not reproduce the grade.

**Tests** use the standard library's `unittest` and run as part of `pnpm test`, which
is also how CI runs them:

```
pnpm test:bench
```
