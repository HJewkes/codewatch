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

## findings/

Finding producers for A1's audit stage. Each writes `findings.jsonl` rows in the contract
`codewatch audit` and `codewatch triage` read, and prints a JSON summary as its last stdout
line for `stages.json`. They call the image's pinned tools by full path under
`/opt/codewatch-a1/bin/`.

- `diff_uncovered`: functions changed since a caller-supplied baseline that no test
  executes, as signal `diff-uncovered`. The baseline is an earlier snapshot directory or a
  git revision (for a PR, its merge-base with main). It runs pytest under coverage.py, or
  reads existing `coverage json` output.

```
cd bench/scbench
python3 -m findings.diff_uncovered --workspace <dir> (--base-rev <sha> | --base-dir <dir>) \
  --out <findings.jsonl> [--coverage-json <file>]
```

**Tests** use the standard library's `unittest` and run as part of `pnpm test`, which
is also how CI runs them:

```
pnpm test:bench
```
