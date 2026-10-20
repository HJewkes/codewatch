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
  --agent <claude_code.yaml for A0 and A1a | agent/claude_code_cw.a1.yaml for A1> \
  --environment configs/environments/docker-python3.12-uv-rootless.yaml \
  --prompt <just-solve | a1a> --model claude_code_oauth/sonnet-5.5 --problem <name> \
  save_dir="$HOME/.cache/codewatch-scbench/runs/<arm>/<UTC timestamp>" save_template=run
```

`agent/claude_code_cw.a1.yaml` is `agent/claude_code_cw.yaml` with all nine stages
enabled. The base file keeps every stage off, so a test can compare the solve argv with
A1a's.

The runner ignores `output_path=`. The launcher refuses a run dir inside any repo
checkout, and the runner's default `save_dir` (`outputs`) is one. It also refuses a
`save_dir` that starts with a literal `~`, because the runner does not expand it.

## Validity notes

- **The agent runs as container root.** Rootless Docker needs `user: "0:0"` so the
  agent can write the mounted workspace. The paper used a non-root user. The setup is the
  same for A0, A1a and A1.
- **`IS_SANDBOX=1`.** Claude Code 2.0.51 refuses `--dangerously-skip-permissions` as
  uid 0 unless `IS_SANDBOX` is set, so the pilot env sets it. The claude argv is
  unchanged. A side effect in the same CLI: under `IS_SANDBOX`, an API overloaded error
  (529) throws instead of retrying. So an overload can end a checkpoint's solve early.
  Report such checkpoints per arm. The env is the same for all three arms.

## prflow/

A1's PR flow (design unit U15): one checkpoint is one PR. The stages keep a git
repository at `GIT_DIR=.codewatch/repo.git` with `core.worktree` set to the workspace.
Only stage processes set `GIT_DIR`, so the solve session sees no `.git` and no
`GIT_DIR`, as in A1a.

- `repo-init` (checkpoint 1) creates the repository. `main` starts with one commit that
  holds only `.codewatch/check.json`, codewatch's default check config. It is idempotent.
- `pr-open` (every checkpoint) opens `cp-N` from `main`. If the previous PR branch was
  never merged, it merges it first.
- `commit-ratchet` commits the solve as `cp-N: solve`. It indexes the head and the
  merge-base with `main` into `.codewatch/cache/graph.db` as `cw-head-cp-N` and
  `cw-merge-base-cp-N`. Then it writes `graph check --baseline cw-merge-base-cp-N` to
  `.codewatch/audit/ratchet-check.json` and `graph diff` to `ratchet-diff.json`.
  `graph index --rev` is newer than `@codewatch/cli` 0.7.0. Without it, the stage
  indexes the work tree, checks with no baseline, writes no diff, and records the reason.
- `python -m prflow pr-merge` merges the checked-out PR branch into `main` and leaves
  HEAD on `main`. The `synthesis` stage ends the PR the same way, with its PR report as
  the merge-commit message (`agent/README.md`, "Stages").

None of these changes a file in the work tree: they only move refs and the index.
`info/exclude` lists the repository itself (git skips a GIT_DIR inside the work tree only
when it is named `.git`), `.codewatch/cache/`, `.codewatch/audit/`, the derived
`.codewatch/session-brief.json` and test and virtualenv output.

**Not graded.** The runner snapshots the whole workspace for grading
(`Snapshot.from_environment_spec`, 31ceea3). So the pilot env adds `.codewatch/*` to the
snapshot's ignore globs. One side effect: a `--resume` restores the workspace from that
snapshot, so the repository and the carry files start fresh after a resume.

## tiert/

Test-shape checks for pytest functions: assertion-free, weak-oracle-only, duplicate
assert and self-compare, written as `findings.jsonl` rows. See `tiert/README.md`.

## smoke/

The U10 credential smoke checks the A1 image's three model paths with the OAuth token:
one `codewatch triage --budget-usd 0.2` run, one 2-turn fix session (U8's `FixSession`)
and one U17 review. They run on a synthetic 3-file workspace, and the spec stays outside
it. Run from `bench/scbench`, with the token as an env prefix:

```
DOCKER_HOST=unix:///run/user/1000/docker.sock \
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/scbench/claude-oauth-token-server)" \
python3 -m smoke.credential_smoke --out "$HOME/.cache/codewatch-scbench/runs/U10/<UTC ts>"
```

`docker run` gets the token by name (`-e CLAUDE_CODE_OAUTH_TOKEN`) and uses the default
bridge network, because the calls need the API. The container runs as 0:0 with
`IS_SANDBOX=1`, as the pilot env does. The run dir holds the three report lines in
`stages.json`, each call's raw output, and Claude's home with its session traces, so a
byte scan for the token covers everything the calls wrote.

The image pins `@codewatch/cli` 0.7.0. Its `triage` has no `--spec`, and its `--model`
defaults to the `sonnet` alias, so the smoke passes `--model claude-sonnet-5-5`.

## review/

The spec-aware commit review (design unit U17): one Sonnet 5.5 call per commit, with no
tools, asking whether the commit changes behaviour the checkpoint spec defines.

```
env PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m review \
  [--spec <file>] [--mode fix|expected-output] [--workspace .] [--tests-dir tests] <sha>
```

Hooks split this line with `shlex` and run it with no shell, so it sets `PYTHONPATH`
through `env`; a bare `PYTHONPATH=...` prefix would be taken as the program name. The
line is `IMAGE_COMMAND` in `review/__init__.py`, and a test runs it that way.

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
  cited); the verdict stands. Spec lines of 12 characters or more that the model repeats
  in `reason`, in any letter case, become `<spec>`. A paraphrase is not caught, so
  `reason` can still carry spec content in other words.

**Fix commits** (`--mode fix`, the default) review the whole commit. The fix stage calls
it as `--review-command "<the command above> --mode fix"`, with the spec file from
`CW_SPEC_FILE`, which the agent sets for the after-solve stages; its hook appends the sha,
reads `verdict`, `spec_line` and `reason`, and resumes the fix session once on a
conflict.

**The solve commit** (`--mode expected-output`) reviews only the files that change
expected outputs: snapshot or golden files (`__snapshots__/`, `golden/`, `expected/`,
`*.snap`, `*.golden`, `*.ambr`, `*.approved`, `*.expected.*`), and test files whose diff
removes an assertion line (`assert`, `self.assert...` or `pytest.raises`). An expectation
edited inside a test helper under another name is not caught. When there are none it
prints `ok` with no model call. The `solve-review` stage runs after `commit-ratchet` (U15)
has committed the solve on `cp-N`, with the argv of the command above plus
`--mode expected-output --spec <file> <sha of cp-N>`.

The stage is `python -m review.solve --workspace /workspace --review-command "<that
command>"`; it reviews the head of `cp-N`. On a conflict it resumes the solve session once
(`--resume $CW_SOLVE_SESSION_ID`, which the agent reads from the solve's stream-json events)
with the reason and spec line, amends the solve commit with the revision and reviews it
again. The resume gets the reviewer's `reason` and line number only, never spec text. Paths
under `.codewatch/` stay out of the amend. The solve is never reverted: a resume that times
out restores the solve commit, and a conflict that stands is recorded. The report line
carries `verdict`, `spec_line`, `resumed`, `second_verdict`, `second_spec_line`,
`solve_commit`, `revised_commit`, `session_id` and `outcome` (`ok`, `revised`, `conflict`,
`error` or `skipped`) into `stages.json`.

## analysis/

`analysis/` reads each arm's run directory after `slop-code eval`, plus A1's
per-checkpoint `stages.json`. That file is in `checkpoint_<n>/agent/`, or in
`agent.tar.gz` when artifacts are compressed; a missing one is an error. The script
writes the decision table as `report.md` and `report.json`. It contains:

- paired per-checkpoint deltas
- per-problem final checkpoints
- the adopt / iterate / drop verdict
- the gaming checks
- mechanism signals: test-gap items per phase, commits kept against reverted, review
  conflicts and resumes, tests added by kind (snapshot or golden, exact output, error
  path, other) and backlog left open, all read from the `fix` stage's `items`
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

## regrade/

The inner-loop regrade (C-240): score a modified tree against its base checkpoint with the
bench's own graders, without re-running a solve. Both trees are staged as the runner
snapshots them (its `snapshot.ignore_globs`, plus `.git`). Each staged copy gets:

- the hidden tests, through the calibrated C-239 harness (`c239/harness/eval.sh`);
- the pinned `scb-check==0.1.3` from `analysis/inputs.py`, once whole (the official
  erosion and verbosity) and once without the tests directory.

`--base` takes a frozen seed (`checkpoint_N/` with `snapshot/` and `evaluation.json`) or a
plain tree. With `--recorded <run>/checkpoint_results.jsonl`, `parity` compares the base's
rerun with the scores the bench recorded for it, and its hidden count with `evaluation.json`.
A no-op copy must show `scores_ok` and `hidden_ok` true and a zero delta.

```
cd bench/scbench
python3 -m regrade --problem code_search --checkpoint 3 --base <seed>/code_search/checkpoint_3 \
  --head <modified tree> --out result.json [--recorded <checkpoint_results.jsonl>] \
  [--tests-dir tests] [--skip-eval]
```

It prints one markdown table row: hidden before → after, then erosion, verbosity, and both
tests-excluded, each before → after. `c239/harness/regrade_all.sh` runs it over the C-239
frozen bases and arm outputs.

C-241 adds arm NEW-C, which uses the same rig. `c239/harness/freeze_c241.sh` freezes the extra
checkpoints, `targets.py` lists the complexity targets, and `run_c241.sh <problem> <N> <key> <name>`
runs `newc_arm.sh`, the audit metrics, the regrade and `gates.py`. `gates.py` checks hidden
must-not-regress, refactor growth, single-caller and test:source, mechanically.
`table_c241.py` prints the table.

**Holdout guard (C-243).** Every run, freeze and regrade entry point (`c239/harness/*.sh`,
`python3 -m regrade`) first runs `regrade/holdout.py`. It reads the holdout list from the
gitignored manifest's `holdout` field and refuses (exit 3) a holdout problem unless
`SCBENCH_MILESTONE` names a milestone with an owner-approved holdout row in
`~/.cache/codewatch-scbench/climb/ledger.jsonl`. That is the climb driver's split-control rule.
Refusals report counts, never names, and an unreadable manifest refuses everything.

**Behaviour-differential gate (C-242).** `c239/harness/diffgate.sh <problem> <N> <base> <head> <out>
[regrade.json] [waivers.json]` records every CLI call that base's `tests/` and the hidden tests for
checkpoints 1..N make. It adds one-edit variants of the JSON those calls read, then replays every
case on base twice and on head once, all in one A1-image container. The gate fails on any exit code,
stdout, stderr or written-file difference that is not spec-required. Spec-required means a hidden test
it came from went from fail to pass, or a waiver quotes the spec verbatim. `diffgate/compare.py`
documents the normalisation rules: paths become placeholders, a traceback compares by its last line,
and a case whose two base runs disagree is excluded and counted. Nothing else is normalised.

## remediation/

The A1 fix stage (design unit U8, Revision 1): one validated commit per confirmed item.
The image copies it in, and `agent/claude_code_cw.yaml` runs it as the `fix` stage, from
the workspace, as
`exec env PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m remediation`,
with `--review-command` set to the fix-commit review above.
It works on the PR branch (`cp-N`) of the hidden repository (`GIT_DIR=.codewatch/repo.git`,
created by the U15 stages); with no repository, or with uncommitted changes, it skips.
Before that check it adds U15's exclude list (`EXCLUDES` in `prflow/repo.py`) to
`$GIT_DIR/info/exclude`, so tool output (bytecode, caches, a virtualenv) and the rebuilt
parts of `.codewatch/` (`repo.git/`, `cache/`, `audit/`) never count as changes, get
committed or are removed by a reset. The committed parts of `.codewatch/`, such as
`taste.md`, stay visible.

**No caps by default.** There is no item cap and no turn cap. `--max-items` and
`--max-turns` exist only as opt-in flags with no default. The stage stops starting items
when less than `--reset-margin` (180 s) remains before `CW_STAGE_DEADLINE`, the stage
deadline the agent passes in, and then resets the work tree to the last kept commit.

1. **Items** come from `.codewatch/audit/` in three phases. Each carries its question,
   verdict, citations and a one-line fix sketch. A verdict item also carries the evidence of
   its finding in `findings.jsonl` (same signal, path and symbol); for `missing-test-kind`
   that names the code kind and the missing test kind, and the fix sketch names the kind.
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
   - a test gap, in any phase: it changes files under the tests directory only, and the
     suite adds no failure the base did not have;
   - a quality item: the suite adds no failure the base did not have, and `codewatch graph check --baseline
     <merge-base>` lists no violation the tree before the commit did not already have.
     The baseline is `cw-merge-base-cp-N`, which `commit-ratchet` indexed, unless
     `--baseline` names another. With a codewatch that has no `graph index --rev`, that
     ref does not exist and quality items are not started ("graph check could not run").

   A failing commit is reverted alone (`git revert`), and the next item still runs; the
   session is told which item was reverted and why.

   The suite runs with an interpreter that imports pytest, found once before the first
   item (`remediation/interpreter.py`): the solve's `.venv`, then `venv`, then the
   `python` on PATH, then the image's pinned pytest (`--tool-pytest`) with the workspace
   and the solve's virtualenv packages on `PYTHONPATH`. A solve that tests with unittest
   often leaves none of the first three with pytest. If none can run the suite, no item
   starts and the outcome is `check-unavailable`, not a revert of every fix.

   Then the check runs once at the base, before any item (`remediation/oracle.py`), and
   the report's `oracle` records `pass`, `base-failing` (with the failing test ids) or
   `unavailable` (with the reason). Each run is `passed` (exit 0 or 5), `failed` (pytest's
   exit 1, naming its failing tests) or `unjudgeable` (a timeout, an interrupted run such
   as a collection error, an exit 1 naming no test, or a custom `--test-command`'s
   failure); only `failed` is compared test by test. At the base, `unjudgeable` is
   `unavailable`, as is a pytest command with `-x` or `--maxfail`, which names only some
   failures. An unavailable check starts no item. A pytest check gets `-rfE` and is judged
   by the ids in its short summary against the base's failing set; an `unjudgeable` item
   run is reverted. Each new failure is rerun once alone, and one that passes on the
   rerun is kept and listed in the item's `flaky`. A custom command names no tests, so it is judged
   by exit code. When three items in a row are reverted for the same reason, the stage
   stops (`stage-stopped`): that points at a broken check, not at the items.
4. **Review hook (U17).** A commit that passes goes to `--review-command <sha>` when one
   is set. That command prints `{"verdict": "ok"|"conflict", "spec_line", "reason"}`. On a
   conflict the session is resumed once with the finding, and the revised commit is
   checked and reviewed again. If the conflict stands, the commit is reverted. With no
   command, the verdict is recorded as `not-configured`.
5. **Phase 3** items each get their own branch, `cw-backlog-<n>-<PR branch>`, from the PR
   branch. A branch is merged back with `--no-ff` only when its commit is kept.

   The hidden repository and the graph database outlive a checkpoint. So every name the
   stage creates carries the PR branch (`cw-backlog-<n>-cp-N`, and the graph refs
   `cw-fix-cp-N`, with `scoped` from `prflow/repo.py`), and a rerun on the same checkpoint resets a
   backlog branch an earlier run left behind.
6. **Safety net.** The whole workspace is copied to `--scratch` (default
   `~/.cache/codewatch-remediation`) first. After an error, or a SIGTERM (the command
   `exec`s python), the stage resets to the last kept commit and drops the copy. If that
   reset fails, it restores the copy. If the restore also fails, the copy stays, and its
   path is printed on stderr.

The report line sets `outcome` (`kept` if any commit was kept, else `reverted`,
`unchanged`, `skipped`, `check-unavailable` or `stage-stopped`), `reason`, `oracle`, `items_in`, `items_out` (commits kept), `held_back`,
`stopped_by`, `session_id`, `turns`, `tokens`, `usd` (the fix session alone),
`review_tokens` and `review_usd` (every review call), `usd_total` (`usd` plus
`review_usd`), `model_usage` (each model's totals from the result events' `modelUsage`, so
a haiku warmup is its own line; transcripts undercount output), `call_usage` (the same per
session call), `added_symbols` (from kept phase-2
and phase-3 commits, flagged `single-caller-helper` when exactly one call reaches them),
and `items`. Each entry in `items` gives the phase, kind (`test-gap` or `quality`), signal,
the missing test kind (for `missing-test-kind`), path, status (`kept`,
`reverted`, `unchanged`, `time limit` or `not-started`), commit sha, reason, review
verdict and whether the session was resumed. A reverted item also gives `cause`, the
check reason the stop rule compares, and an item with a failure that passed on its rerun
gives `flaky`.

## findings/

Finding producers for A1's audit stage. Each writes `findings.jsonl` rows in the contract
`codewatch audit` and `codewatch triage` read, and prints a JSON summary as its last stdout
line for `stages.json`. They call the image's pinned tools by full path under
`/opt/codewatch-a1/bin/`.

- `diff_uncovered`: functions changed since a caller-supplied baseline that no test
  executes, as signal `diff-uncovered`. The baseline is an earlier snapshot directory or a
  git revision (for a PR, its merge-base with main). It runs pytest under coverage.py, or
  reads existing `coverage json` output. An unreadable baseline or a missing report is
  unknown, not a finding: it writes no rows and exits 1. So is a pytest run that did not
  run the tests (exit 2 to 5, such as a collection error) or a report that measured none
  of the workspace's files. The image's coverage and pytest live in their own venv, which
  lacks the workspace's third-party dependencies. A scratch `sitecustomize` on `PYTHONPATH`
  appends the workspace virtualenv's packages (`.venv` or `venv`, the running interpreter's
  `lib/pythonX.Y/site-packages` only) after the tools venv's own, so the pinned coverage.py
  and pytest always win. A dependency installed anywhere else, or only for another Python,
  still fails the tests' imports and gives `no-coverage`.
  Python subprocesses the tests start are measured too (a scratch rcfile with
  `patch = subprocess`, then `coverage combine`), except one started under an interpreter
  without coverage installed, such as the workspace's own venv python: its functions
  still read as untested.
- `clones`: jscpd over the workspace's source and tests with the config pinned in
  `findings/jscpd.json` (min-tokens 60, JSON reporter), as signal `clone`. Each pair is
  one row whose evidence names the other copy as `<path>:<start>-<end>`, the form
  `codewatch triage`'s clone question reads. jscpd matches its ignore globs against
  absolute paths, so the config names tool directories (`.venv`, `.git`) rather than
  every hidden directory.
- `audit_stage`: the audit stage's command. It runs `codewatch audit` (which rewrites
  `findings.jsonl`), then Tier T, `diff_uncovered` and `clones`, each appending its rows.
  Diff coverage and `audit --changed-from` get the PR's merge-base commit from the hidden
  repository; the graph ref `cw-merge-base-cp-N` is a snapshot name, not a git ref. Audit
  flags the installed codewatch lacks (`--changed-from`, `--no-ts-slop`) are left out.
  A failed `codewatch audit` gives outcome `failed`. Anything else recorded in `reason` (a
  source that exits non-zero, diff coverage not running for want of a merge-base, ignored
  paths that could not be dropped) gives outcome `degraded`, keeping the other rows.
  Either exits 1, so the stage's status is `failed` and the checkpoint goes on to the
  next stage.

```
cd bench/scbench
python3 -m findings.diff_uncovered --workspace <dir> (--base-rev <sha> | --base-dir <dir>) \
  --out <findings.jsonl> [--coverage-json <file>]
python3 -m findings.clones --workspace <dir> --out <findings.jsonl> [--report <jscpd json>]
```

**Tests** use the standard library's `unittest` and run as part of `pnpm test`, which
is also how CI runs them:

```
pnpm test:bench
```
