#!/usr/bin/env bash
# usage: ar_preflight.sh <case set> <problem> <case>
# The autoresearch pre-flight (C-256), called at pin time: make sure the tmpfs inputs of <case>, a
# prep_c246.sh key, exist and still match the hash recorded when they were prepped. A missing prep runs
# prep_c246.sh and records the hash of the frozen final checkpoint; a changed tree exits 5.
set -uo pipefail
set=$1; problem=$2; case_=$3
A=$(cd "$(dirname "$0")" && pwd); BENCH=$(cd "$A/.." && pwd); R=${S7_INPUTS:-/tmp/c246}
prep=$R/prep/$case_.json; record=$R/prep/$case_.sha256
field() { python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
tree_hash() { (cd "$1" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1); }

if [ ! -f "$prep" ]; then
  bash "$BENCH/c239/harness/prep_c246.sh" "$set" "$problem" "$case_" >/dev/null || exit $?
  rm -f "$record"
fi
python3 -I -c 'import json, sys; sys.exit(0 if json.load(open(sys.argv[1])).get("evaluable", True) else 6)' "$prep" \
  || { echo "ar_preflight: $case_ is not evaluable" >&2; exit 6; }
frozen=$R/frozen/$set/${problem}_cp$(field "$prep" n)
[ -d "$frozen" ] || { echo "ar_preflight: missing $frozen" >&2; exit 5; }
now=$(tree_hash "$frozen")
[ -f "$record" ] || echo "$now" >"$record"
[ "$(cat "$record")" = "$now" ] || { echo "ar_preflight: $case_ inputs differ from the recorded hash" >&2; exit 5; }
echo "ar_preflight: $case_ ok $now"
