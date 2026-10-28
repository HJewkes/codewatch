#!/usr/bin/env bash
# usage: ar_eval.sh <case set> <case> <key> <max usd> <runner root> [--keep-lanes]
# The autoresearch seed rung (C-256): one S7 run (c239/harness/run_s7.sh) of the cleanup runner from
# <runner root> (an idea tree's bench/scbench) on <case>, a prep_c246.sh key, under the run key <key>, scored
# by score.py. Everything but the runner comes from this checkout, the evaluator pin. Prints one
# ar-result/v2 line; the S7 log is ~/.cache/c248-s7/logs/<key>.log and the artifacts stay in
# ~/.cache/c248-s7/runs/<key> (artifact_dir).
set -uo pipefail
set=$1; case_=$2; key=$3; max_usd=$4; runner_root=$(realpath "$5"); keep_lanes=${6:-}
A=$(cd "$(dirname "$0")" && pwd); BENCH=$(cd "$A/.." && pwd)
prep=${S7_INPUTS:-/tmp/c246}/prep/$case_.json
problem=$(python3 -I -c 'import json, sys; p = json.load(open(sys.argv[1]))
sys.exit("ar_eval: the case is in another case set") if p["set"] != sys.argv[2] else print(p["problem"])' "$prep" "$set") || exit 2
python3 -I "$BENCH/regrade/holdout.py" "$problem" || exit 3
run=$HOME/.cache/c248-s7/runs/$key; log=$HOME/.cache/c248-s7/logs/$key.log
mkdir -p "$(dirname "$log")"
pin=$(git -C "$BENCH" rev-parse HEAD 2>/dev/null || echo unknown)
start=$(date +%s)
S7_CASE=$case_ RUNNER_ROOT=$runner_root bash "$BENCH/c239/harness/run_s7.sh" "$set" "$problem" "$key" "$max_usd" \
  ${keep_lanes:+"$keep_lanes"} >"$log" 2>&1
rc=$?
[ "$rc" -eq 0 ] || { echo "ar_eval: run_s7.sh exited $rc; see $log" >&2; exit "$rc"; }
python3 -I "$A/score.py" "$run" --case "$case_" --repeat "$key" --wall-s "$(($(date +%s) - start))" --pin "$pin"
