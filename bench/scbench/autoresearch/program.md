# Autoresearch target: the C-248 cleanup runner

This directory is codewatch's target adapter for the autoresearch engine (C-256). The engine reads
`target.json` and `bounds.json` at the evaluator pin and runs the commands they name. Nothing outside this
directory names a codewatch metric.

## What is being improved

The cleanup runner (`python3 -m runner`, `bench/scbench/runner`) plans refactoring tasks for one seed's
final checkpoint, runs one model session per task, judges each with the final gate (`gate/gates.py`) and
splices the accepted lanes. The S7 validation (`../c248-s7-validation.md`) found that it lowers high-CC
mass but raises total cyclomatic complexity and adds single-caller helpers: the gate accepts splits that
the C-241 helpers and growth gates reject. An idea changes the runner so a run lowers total CC without
adding single-caller helpers or breaking a hidden test.

## The keep rule's inputs (`target.json` `metric`)

- **Primary:** `cc_total_delta_pct`, total cyclomatic complexity of the non-test source after the run
  against before, in percent. Lower is better.
- **Guard:** `single_caller_delta` (one-site single-caller helpers after minus before) may not rise by more
  than 1 over the best.
- **Zero tolerance:** `hidden_regressions`, hidden tests that passed before and fail after.
- **All gates:** `hidden`, `growth`, `helpers` and `tests`, the C-241 gates of `c239/harness/gates.py`.
- **No-op:** `accepted_tasks` is 0 when no lane was accepted, so the tree is unchanged.

`score.py` emits these as `ar-result/v2`, plus reported-only metrics (`src_net`, `helpers_one_site_delta`,
`cog_max_delta`).

## What an idea may change (`bounds.json`)

One change class per idea, and only that class's paths:

| Class | Paths | Micro rung |
| --- | --- | --- |
| `planner-ranking` | `planner/{rank,recipes,families,tasks,classes,units}.py` | L1-cluster: one session on one cluster |
| `accept-gate` | `gate/gates.py`, `ledger/rules.py` | L1-replay: the best's lanes re-judged, $0 |
| `session-prompt` | `runner/prompt.py`, `planner/template.py` | L1-cluster |
| `config-param` | `planner/config.json`, inside the ranges in `bounds.json` | L1-replay |

Every class but `config-param` needs a test under its test globs that fails on the ratchet head and passes
on the idea (`ar_testproof.sh`). The evaluator is frozen (`target.json` `frozen`): the harness, regrade,
measure, replay, calibration, this directory and its tests. Ideas name no seed and add no numeric literal
outside the config other than 0, 1, 2 and -1. Diff size is recorded, not capped.

## Commands

| Command | Rung | Cost |
| --- | --- | --- |
| `ar_testproof.sh <base> <head>` | L0 | $0 |
| `ar_micro.sh replay <runner root> <baseline dir> <signal>` | L1 for gate and config ideas | $0 |
| `ar_micro.sh cluster <runner root> <case set> <case> <cluster> <baseline dir> <signal> [usd]` | L1 for planner and prompt ideas | ≤ $0.25 |
| `ar_eval.sh <case set> <case> <key> <max usd> <runner root> [--keep-lanes]` | seed run | about $0.45 |

`<runner root>` is the idea tree's `bench/scbench`: the runner runs from there (`RUNNER_ROOT` in
`c239/harness/run_s7.sh`), and measure, diffgate, regrade, the gates and score run from the pin. Every
wrapper runs the `regrade/holdout.py` guard first. A case is a `prep_c246.sh` key under `/tmp/c246/prep`
(override with `S7_INPUTS`); the local queue maps the `train-N` keys to seeds, so no seed is named here.
`<signal>` is the idea's predicted move of one micro count, such as `accepted_net_cc:down`.

## Naming the micro signal in an idea

- `expectedEffect.microSignal` is a count name from `ar-micro/v1`: `accepts`, `rejects`, `accepted_net_cc` or
  `accepted_new_helpers`. `expectedEffect.direction` is `up` or `down`; the evaluator joins them as
  `<count>:<direction>`.
- An idea of an L1-cluster class (`planner-ranking`, `session-prompt`) names the runner cluster the session
  runs on in `microArgs.cluster`. Ideas of the L1-replay classes need no `microArgs`.

## Pre-flight

`ar_preflight.sh <case set> <problem> <case>` runs at pin time. It runs `prep_c246.sh` when the case has no
prep, then checks the frozen final checkpoint under `/tmp/c246` (or `S7_INPUTS`) against the hash recorded at
prep, and exits 5 when the inputs changed.
