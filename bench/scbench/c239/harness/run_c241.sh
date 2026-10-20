#!/usr/bin/env bash
# usage: run_c241.sh <problem> <N> <key> <run name>
# <key> names the measurement and report files (/tmp/c241/meas/<key>N, reports/<key>N.txt).
# C-241: one NEW-C run on frozen cp(N), then audit metrics, the C-240 regrade against the seed
# (hidden tests + official and ex-tests erosion/verbosity), the exact diff and the gates.
set -uo pipefail
problem=$1; n=$2; k=$3; name=$4
python3 -I "$(cd "$(dirname "$0")/../.." && pwd)/regrade/holdout.py" "$problem" || exit 3
H=$(cd "$(dirname "$0")" && pwd); BENCH=$(cd "$H/../.." && pwd); C=/tmp/c241; run=$C/runs/$name
SEEDS=$HOME/.local/share/codewatch-scbench/seeds
seeds=$SEEDS/c209-a1a; [ -d "$seeds/$problem" ] || seeds=$SEEDS/c209-suite
bash "$H/newc_arm.sh" "$problem" "$n" "$C/reports/$k$n.txt" "$C/reports/$k${n}_targets.txt" "$run"
bash "$H/measure.sh" "$run/ws" "$run/meas" >/dev/null
python3 -I -c 'import sys; sys.path.insert(0, sys.argv.pop(1)); from regrade.__main__ import main; sys.exit(main())' \
  "$BENCH" --problem "$problem" --checkpoint "$n" --base "$seeds/$problem/checkpoint_$n" --head "$run/ws" \
  --label "$name" --out "$run/regrade.json" --scratch "$run/scratch"
rm -rf "$run/scratch"
diff -ruN -x .git -x .venv -x venv -x .codewatch -x __pycache__ -x .pytest_cache -x .ruff_cache \
  "$C/frozen/${problem}_cp$n/" "$run/ws" >"$run/change.diff"
python3 -I "$H/gates.py" "$C/meas/$k$n" "$run/meas" "$run/regrade.json" "$run"
