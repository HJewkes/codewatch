# solvenext/

The next-checkpoint solve harness (C-250, called "C-249 E2" in the cleanup plan). It answers:
given a frozen tree at checkpoint N, how well does a fresh solve of checkpoint N+1 do?

```
bench/scbench/c239/harness/solve_next.sh <problem> <N> <tree> --seed-set <set> \
  [--seed-cp <seed checkpoint_N dir>] [--arm original] [--replicate 1] [--out <dir>] [--dry-run]
```

- `<tree>` is a seed `checkpoint_N/` dir (its `snapshot/` is used) or any plain tree, such
  as a cleaned copy. The tree is always copied to `<out>/ws` first. The harness refuses an
  output dir inside the seeds (`SCBENCH_SEEDS`, default
  `~/.local/share/codewatch-scbench/seeds`), one that overlaps the tree, and one that already
  holds a run.
- The solve has the `new_arm.sh` shape: one headless `claude -p` in the A1 image, with the
  A1a arm's prompt (`prompts/a1a.jinja`, rendered for a continuation the way the runner
  renders it at 31ceea3), its model (`configs/models/sonnet-5.5.yaml`) and its step limit
  (`agent/claude_code_cw.yaml`). It does not use the runner's `--resume`, because that
  restores the workspace from the runner's own snapshot.
- Then `c239/harness/eval.sh` grades cp N+1. It lays out the hidden tests with the
  checkpoint's `include_prior_tests`.
- `<out>/run.json` (schema `codewatch.solvenext.run/2`, `/1` is still read, `record.py`) records the pins
  (harness commit and dirty flag, scb-check and slop-code versions, model, image, prompt
  sha256, step limit, seed set), the cost and turns, and three hidden pass rates. `before` is
  the seed's recorded cp N rate, `after` is this solve's cp N+1 rate, and `recorded_next` is
  the seed's recorded cp N+1 rate. `tree_changed` says whether the solved tree differs from the
  seed cp N tree (ignoring `.venv`, `__pycache__`, `.pytest_cache`, `.evaluation_tests`,
  `pytest.ini`, `.report.json`), `reference_noop` whether the seed's own cp N+1 tree equals its
  cp N tree, and `cost.is_error` and `cost.exit` are the claude result and the claude exit status
  (the cleanup chmod no longer changes it). The solve sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`,
  pinned as `max_output_tokens`.
- The default `<out>` is
  `~/.local/share/codewatch-scbench/experiments/c250-solvenext-<date>/<arm>/<problem>-cp<N+1>-r<rep>`.
- `--dry-run` prints the command plan and the output paths, and writes nothing.

Both the script and `python -m solvenext` run the holdout guard (C-243) before anything else.

## Parity

```
cd bench/scbench && python3 -m solvenext parity <runs dir> [--out <dir>]
```

This reads every `run.json` under the dir. For each problem in the `original` arm it compares
the replicates' cp N+1 rates with `recorded_next`, then writes `parity.json` and `parity.md`.
The threshold is C-210's rule: T = max(15 points, 2 x spread), where spread is the range of
the replicate rates. Parity holds when every replicate is within T of the recorded rate. The
command refuses holdout problems before it writes anything.

Runs that errored or left the tree unchanged are left out of the replicate set and counted. A
problem whose recorded reference is a no-op is refused and counted. For schema /1 runs the
flags are derived from the run's `ws/` and the seed set when both are on disk.
