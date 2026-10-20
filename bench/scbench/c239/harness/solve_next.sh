#!/usr/bin/env bash
# usage: solve_next.sh <problem> <N> <tree> [solvenext run options, e.g. --seed-set c209-a1a --dry-run]
# C-250 (the plan doc's C-249 E2): a headless solve of cp(N+1) on a copy of a frozen tree, in the
# new_arm.sh shape (the A1a solve prompt, model and step limit), then eval.sh for cp(N+1) with the
# config's include_prior_tests, then run.json. Not the runner's --resume: that restores its own snapshot.
set -uo pipefail
bench=$(cd "$(dirname "$0")/../.." && pwd)
[ $# -ge 3 ] || { echo "usage: solve_next.sh <problem> <N> <tree> [options]" >&2; exit 2; }
python3 -I "$bench/regrade/holdout.py" "$1" || exit 3
PYTHONPATH="$bench" exec python3 -P -m solvenext run "$@"
