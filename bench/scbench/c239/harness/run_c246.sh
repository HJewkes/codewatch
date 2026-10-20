#!/usr/bin/env bash
# usage: run_c246.sh <seed set> <problem> <key>
# C-246 phase B, after prep_c246.sh: one NEW-C run on frozen cpN, then audit metrics, the C-242
# in-loop diff gate (base = frozen cpN, no hidden tests), the C-240 regrade against the seed and the
# C-241 gates. Results land in ~/.cache/c246/runs/<key>; the workspace copies are pruned once
# scored, keeping only the JSON, logs and change.diff.
set -uo pipefail
set=$1; problem=$2; key=$3
H=$(cd "$(dirname "$0")" && pwd); BENCH=$(cd "$H/../.." && pwd)
python3 -I "$BENCH/regrade/holdout.py" "$problem" || exit 3
R=/tmp/c246; W=$HOME/.cache/c246; run=$W/runs/$key; M=$W/meas/$key; F=$R/frozen/$set
n=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["n"])' "$R/prep/$key.json")
FROZEN=$F bash "$H/newc_arm.sh" "$problem" "$n" "$R/reports/$key.txt" "$R/reports/${key}_targets.txt" "$run"
rm -rf "$run/ws/.venv"
bash "$H/measure.sh" "$run/ws" "$run/meas" >/dev/null
rm -rf "$run/meas/ws/.venv"
bash "$H/diffgate.sh" "$problem" "$n" "$F/${problem}_cp$n" "$run/ws" "$run/diffgate" inloop >/dev/null
rm -rf "$run/diffgate/work"
python3 -I -c 'import sys; sys.path.insert(0, sys.argv.pop(1)); from regrade.__main__ import main; sys.exit(main())' \
  "$BENCH" --problem "$problem" --checkpoint "$n" --base "$R/seeds/$set/$problem/checkpoint_$n" --head "$run/ws" \
  --label "$key" --out "$run/regrade.json" --scratch "$run/scratch"
rm -rf "$run/scratch"
diff -ruN -x .git -x .venv -x venv -x .codewatch -x __pycache__ -x .pytest_cache -x .ruff_cache \
  "$F/${problem}_cp$n/" "$run/ws" >"$run/change.diff"
python3 -I "$H/gates.py" "$M/head" "$run/meas" "$run/regrade.json" "$run"
rm -rf "$run/ws" "$run/meas/ws"
