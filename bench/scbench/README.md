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

## remediation/

The A1 `remediation` stage (design unit U8): propose, validate, discard. The image copies
it in, and `agent/claude_code_cw.yaml` runs it in the checkpoint's container as
`/opt/codewatch-a1/py/bin/python -P -m remediation`, from the workspace.

1. **Items.** At most 8 confirmed items from `.codewatch/audit/`, in this order:
   regressions (`regnet-diff` verdicts), uncovered changed symbols (`diff-uncovered`
   findings, which nothing emits until U5 lands), weak oracles, then quality findings. Each carries its question, verdict,
   citations and a one-line fix sketch. When `triage.json` says the controls failed, or a
   verdict is itself provisional, only regression and coverage items go in; `held_back`
   counts the rest.
2. **Session.** One claude CLI session with the solve's binary, model, permission mode and
   credential env, capped at 30 turns. It runs under a fresh `--session-id`, recorded as
   `session_id` in `stages.json`, so the transcript audit and the analysis can tell its
   trace from the solve's in the shared `~/.claude`. The prompt names no grader, grader
   tool or grader metric.
3. **Validation.** The agent's tests pass (`--test-command`, run with the workspace's
   `.venv/bin` first on `PATH`; "no tests collected" passes). The replay shows no diff
   that was not there before the session. `codewatch graph check --baseline <the snapshot
   indexed just before the session>` reports no new violation.
4. **Discard.** The whole workspace, `.codewatch/` included, is copied to `--scratch`
   (default `~/.cache/codewatch-remediation`) before the session and copied back when any
   check fails, the session times out (`--session-timeout`, 15 minutes) or fails, or the
   stage is stopped (the stage command `exec`s python, so a SIGTERM reaches it). The copy
   is deleted only once the edit is kept or the restore has finished. If the restore
   fails, the copy stays and the report gives its path as `backup`.

The replay net (U3) is not built. `--replay-command` is the plug: a command that prints
`{"diffs": [call ids]}` as its last line. With no command, or no `.codewatch/regnet/`,
the check passes and records `replay unavailable`.

The report line sets `outcome` (`kept`, `discarded` or `skipped`), `reason`,
`validation` (each check's name, pass and detail), `session_id`, `turns`, `tokens`,
`usd`, `items_in`, `items_out` (items sent in a kept session), `held_back` and
`fixed_replay_diffs` (diffs gone after a kept session).

**Tests** use the standard library's `unittest` and run as part of `pnpm test`, which
is also how CI runs them:

```
pnpm test:bench
```
