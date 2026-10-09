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

The A1 fix stage (design unit U8, Revision 1): one validated commit per confirmed item.
The image copies it in, and `agent/claude_code_cw.yaml` runs it from the workspace as
`exec env PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m remediation`.
It works on the PR branch (`cp-N`) of the hidden repository (`GIT_DIR=.codewatch/repo.git`,
created by the U15 stages); with no repository, or with uncommitted changes, it skips.
Before that check it adds tool output (`.codewatch/`, `__pycache__/`, `*.pyc`,
`.pytest_cache/`, `.venv/` and other caches; `TOOL_OUTPUT` in `git.py`) to
`$GIT_DIR/info/exclude`, so only source and test edits count as changes, get committed or
are removed by a reset.

**No caps by default.** There is no item cap and no turn cap. `--max-items` and
`--max-turns` exist only as opt-in flags with no default. The stage stops starting items
when less than `--reset-margin` (180 s) remains before `CW_DEADLINE`, the stage deadline
the agent passes in, and then resets the work tree to the last kept commit.

1. **Items** come from `.codewatch/audit/` in three phases. Each carries its question,
   verdict, citations and a one-line fix sketch.
   - Phase 1, test gaps on files the PR changed (`git diff <merge-base>`): `diff-uncovered`
     findings (U5), confirmed weak-oracle verdicts, and confirmed `missing-test-kind`
     verdicts (U7b).
   - Phase 2, confirmed quality findings on changed files.
   - Phase 3, confirmed findings on any other file, test gaps first.

   When `triage.json` says the controls failed, or a verdict is itself provisional,
   quality items are held back (`held_back` counts them).
2. **Session.** One claude session with the solve's binary, model, permission mode and
   credential env. The first item starts it under a fresh `--session-id`, and each later
   item resumes it. `stages.json` records the id, so the transcript audit and the
   analysis can tell its trace from the solve's in the shared `~/.claude`. The prompts
   name no grader, grader tool or grader metric.
3. **One commit per item**, kept only if it passes these checks:
   - phase 1: it changes files under the tests directory only, and the suite is green;
   - phases 2 and 3: the suite is green, and `codewatch graph check --baseline
     <merge-base>` lists no violation the tree before the commit did not already have.
     The merge-base is indexed with `graph index --rev` unless `--baseline` names it.

   A failing commit is reverted alone (`git revert`), and the next item still runs; the
   session is told which item was reverted and why.
4. **Review hook (U17).** A commit that passes goes to `--review-command <sha>` when one
   is set. That command prints `{"verdict": "ok"|"conflict", "spec_line", "reason"}`. On a
   conflict the session is resumed once with the finding, and the revised commit is
   checked and reviewed again. If the conflict stands, the commit is reverted. With no
   command, the verdict is recorded as `not-configured`.
5. **Phase 3** items each get their own branch, `cw-backlog-<n>`, from the PR branch. A
   branch is merged back with `--no-ff` only when its commit is kept.
6. **Safety net.** The whole workspace is copied to `--scratch` (default
   `~/.cache/codewatch-remediation`) first. After an error, or a SIGTERM (the command
   `exec`s python), the stage resets to the last kept commit and drops the copy. If that
   reset fails, it restores the copy. If the restore also fails, the copy stays, and its
   path is printed on stderr.

The report line sets `outcome` (`kept` if any commit was kept, else `reverted`,
`unchanged` or `skipped`), `reason`, `items_in`, `items_out` (commits kept), `held_back`,
`stopped_by`, `session_id`, `turns`, `tokens`, `usd`, `added_symbols` (from kept phase-2
and phase-3 commits, flagged `single-caller-helper` when exactly one call reaches them),
and `items`. Each entry in `items` gives the phase, signal, path, status (`kept`,
`reverted`, `unchanged`, `time limit` or `not-started`), commit sha, reason, review
verdict and whether the session was resumed.

**Tests** use the standard library's `unittest` and run as part of `pnpm test`, which
is also how CI runs them:

```
pnpm test:bench
```
