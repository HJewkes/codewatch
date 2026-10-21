#!/usr/bin/env bash
# usage: run_s7.sh <seed set> <problem> <key> <max usd>
# C-248 S7: run_c246.sh with the NEW-C session replaced by the A1 fix stage, the cleanup runner
# (python3 -m runner ... --apply) on a copy of frozen cpN, after prep_c246.sh. Then the same scoring:
# audit metrics, the C-242 in-loop diff gate, the C-240 regrade, the C-241 gates and the cleanup report.
# Results land in ~/.cache/c248-s7/runs/<key>; result.json carries the run's total_cost_usd for
# table_c246.py. The workspace copies are pruned once scored.
set -uo pipefail
set=$1; problem=$2; key=$3; max_usd=$4
H=$(cd "$(dirname "$0")" && pwd); BENCH=$(cd "$H/../.." && pwd)
python3 -I "$BENCH/regrade/holdout.py" "$problem" || exit 3
R=/tmp/c246; W=$HOME/.cache/c248-s7; run=$W/runs/$key; M=$HOME/.cache/c246/meas/$key; F=$R/frozen/$set
n=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["n"])' "$R/prep/$key.json")
[ -f "$run/cleanup.json" ] && { echo "run_s7: $key is already scored; move $run aside to rerun it" >&2; exit 5; }
# A killed run leaves files the containers wrote (uid-mapped, e.g. tests/__pycache__) that the host cannot
# remove, and the runner fails on a lane directory that already exists; clear them with the image first.
[ -d "$run" ] && DOCKER_HOST=unix:///run/user/1000/docker.sock docker run --rm -v "$run:/x" --entrypoint bash \
  codewatch-scbench:a1-cw0.7.0-eaf087f -c 'rm -rf /x/* 2>/dev/null; true'
rm -rf "$run"; mkdir -p "$run"; cp -aL "$F/${problem}_cp$n" "$run/ws"
(cd "$BENCH" && python3 -m runner "$run/ws" --problem "$problem" --checkpoint "$n" --out "$run/cleanup" \
  --label "$key" --max-usd "$max_usd" --max-load "${S7_MAX_LOAD:-28}" --apply) >"$run/runner.out" 2>"$run/runner.err"
python3 -I -c 'import json, sys; u = json.load(open(sys.argv[1]))["usd"]; print(json.dumps({"total_cost_usd": u}))' \
  "$run/cleanup/run.json" >"$run/result.json"
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
python3 -I "$H/cleanup_report.py" "$F/${problem}_cp$n" "$run/ws" --json "$run/cleanup.json" >"$run/cleanup.txt"
rm -rf "$run/ws" "$run/meas/ws"
