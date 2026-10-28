#!/usr/bin/env bash
# usage: ar_micro.sh replay  <runner root> <baseline dir> <signal>
#        ar_micro.sh cluster <runner root> <case set> <case> <cluster> <baseline dir> <signal> [max usd]
# The autoresearch L1 micro rung (C-256); prints one ar-micro/v1 line. <baseline dir> is an ar_eval.sh run
# dir kept with --keep-lanes; <signal> is the idea's predicted move, `<count>:<up|down>` (see micro.py).
#   replay   $0: the baseline's lanes re-judged with this checkout's final gate, then with <runner root>'s.
#   cluster  one runner session (--only <cluster>, default cap $0.25) from <runner root> on a copy of the
#            case's frozen tree, against the baseline's recorded lane for that cluster.
set -uo pipefail
mode=$1; runner_root=$(realpath "$2")
A=$(cd "$(dirname "$0")" && pwd); BENCH=$(cd "$A/.." && pwd); R=${S7_INPUTS:-/tmp/c246}
guard() { python3 -I "$BENCH/regrade/holdout.py" "$1" || exit 3; }
field() { python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

if [ "$mode" = replay ]; then
  dir=$3; signal=$4
  guard "$(field "$R/prep/$(field "$dir/ar-result.json" case).json" problem)"
  base=$(python3 -I "$A/micro.py" replay "$BENCH" "$dir") || exit 4
  idea=$(python3 -I "$A/micro.py" replay "$runner_root" "$dir") || exit 4
  python3 -I "$A/micro.py" compare "$base" "$idea" "$signal" L1-replay
elif [ "$mode" = cluster ]; then
  set=$3; case_=$4; cluster=$5; dir=$6; signal=$7; max_usd=${8:-0.25}
  problem=$(field "$R/prep/$case_.json" problem); n=$(field "$R/prep/$case_.json" n)
  guard "$problem"
  out=$(mktemp -d "${TMPDIR:-/tmp}/ar-micro.XXXXXX"); trap 'rm -rf "$out"' EXIT
  cp -aL "$R/frozen/$set/${problem}_cp$n" "$out/ws"
  (cd "$runner_root" && python3 -m runner "$out/ws" --problem "$problem" --checkpoint "$n" --out "$out/cleanup" \
    --label "micro-$case_" --only "$cluster" --max-usd "$max_usd" --max-load "${S7_MAX_LOAD:-28}") \
    >"$out/runner.out" 2>"$out/runner.err" || { cat "$out/runner.err" >&2; exit 4; }
  usd=$(field "$out/cleanup/run.json" usd)
  base=$(python3 -I "$A/micro.py" recorded "$BENCH" "$dir" "$cluster") || exit 4
  idea=$(python3 -I "$A/micro.py" recorded "$BENCH" "$out" "$cluster") || exit 4
  python3 -I "$A/micro.py" compare "$base" "$idea" "$signal" L1-cluster "$usd"
else
  echo "ar_micro: mode is replay or cluster" >&2; exit 2
fi
