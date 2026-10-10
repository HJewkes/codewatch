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
  save_dir="$HOME/.cache/codewatch-scbench/runs/<arm>/<UTC timestamp>" save_template=run
```

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
  HEAD on `main`, for the stage that ends the PR.

None of these changes a file in the work tree: they only move refs and the index.
`info/exclude` lists the repository itself (git skips a GIT_DIR inside the work tree only
when it is named `.git`), `.codewatch/cache/`, `.codewatch/audit/` and test and
virtualenv output.

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
it as `--review-command "<the command above> --spec <file>"`; its hook appends the sha,
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

## remediation/

The A1 fix stage (design unit U8, Revision 1): one validated commit per confirmed item.
The image copies it in, and `agent/claude_code_cw.yaml` runs it as the `fix` stage, from
the workspace, as
`exec env PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m remediation`.
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
     suite is green;
   - a quality item: the suite is green, and `codewatch graph check --baseline
     <merge-base>` lists no violation the tree before the commit did not already have.
     The baseline is `cw-merge-base-cp-N`, which `commit-ratchet` indexed, unless
     `--baseline` names another. With a codewatch that has no `graph index --rev`, that
     ref does not exist and quality items are not started ("graph check could not run").

   A failing commit is reverted alone (`git revert`), and the next item still runs; the
   session is told which item was reverted and why.
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
`unchanged` or `skipped`), `reason`, `items_in`, `items_out` (commits kept), `held_back`,
`stopped_by`, `session_id`, `turns`, `tokens`, `usd`, `added_symbols` (from kept phase-2
and phase-3 commits, flagged `single-caller-helper` when exactly one call reaches them),
and `items`. Each entry in `items` gives the phase, signal, path, status (`kept`,
`reverted`, `unchanged`, `time limit` or `not-started`), commit sha, reason, review
verdict and whether the session was resumed.

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
  lacks the workspace's third-party dependencies; a workspace that needs them gets
  `no-coverage` unless the caller passes a report made with the workspace's interpreter.
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
