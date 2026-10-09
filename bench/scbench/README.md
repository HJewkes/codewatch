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

## tiert/

Test-shape checks for pytest functions: assertion-free, weak-oracle-only, duplicate
assert and self-compare, written as `findings.jsonl` rows. See `tiert/README.md`.

## review/

The spec-aware commit review (design unit U17): one Sonnet 5.5 call per commit, with no
tools, asking whether the commit changes behaviour the checkpoint spec defines.

```
PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m review \
  [--spec <file>] [--mode fix|expected-output] [--workspace .] [--tests-dir tests] <sha>
```

- **Inputs.** The commit's `git show` diff (from the repository `GIT_DIR` names, so it
  runs in the stage's environment), the spec and the workspace's `NOTES.md`. The spec
  comes from `--spec` or `$CW_SPEC_FILE`. A spec file inside the workspace is refused, and
  no spec text is written anywhere.
- **The call** reuses the synthesis stage's `claude -p` invocation: built-in tools
  disallowed, an empty MCP config and `--setting-sources ""`. The model is
  `$CW_REVIEW_MODEL`, default `claude-sonnet-5-5`. The prompt names no grader or grader
  metric.
- **Output.** The last stdout line is `{"verdict": "ok"|"conflict", "spec_line",
  "reason", "citation", "commit", "mode", "files", "tokens", "usd"}`, with exit 0. Any
  failure exits 1 with the reason on stderr.
- **Citation check.** The model cites a spec line by number and copies its text. The
  citation is `verified` only when that line exists and contains the copied text.
  Otherwise `spec_line` is null and `citation` is `failed` (`none` when nothing was
  cited); the verdict stands. Spec lines the model repeats in `reason` become `<spec>`.

**Fix commits** (`--mode fix`, the default) review the whole commit. The fix stage calls
it as `--review-command "<the command above> --spec <file>"`; its hook appends the sha,
reads `verdict`, `spec_line` and `reason`, and resumes the fix session once on a
conflict.

**The solve commit** (`--mode expected-output`) reviews only the files that change
expected outputs: snapshot or golden files (`__snapshots__/`, `golden/`, `expected/`,
`*.snap`, `*.golden`, `*.ambr`, `*.approved`, `*.expected.*`), and test files whose diff
removes an assertion line. When there are none it prints `ok` with no model call. The
`solve-review` stage runs after `commit-ratchet` (U15) has committed the solve on `cp-N`:

```
<the command above> --mode expected-output --spec <file> $(git rev-parse cp-N)
```

On a conflict it resumes the solve session once (`--resume <solve session id>`) with the
reason and spec line, commits the revision and reviews it again. It writes the report
line, plus `resumed` and the second verdict, into `stages.json`.

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
