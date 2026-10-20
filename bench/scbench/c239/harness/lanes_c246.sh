#!/usr/bin/env bash
# usage: lanes_c246.sh <queue file> <lanes> <headless cap USD>
# C-246 phase B driver: <lanes> workers take "<seed set> <problem> <key>" lines from the queue in
# order (tier-interleaved by the caller) and run run_c246.sh on each. Before taking a line a worker
# sums total_cost_usd over every finished run's result.json, plus an in-flight estimate, and stops
# when that reaches the cap. Logs go to ~/.cache/c246/logs/<key>.log.
set -uo pipefail
queue=$(realpath "$1"); lanes=$2; cap=$3
H=$(cd "$(dirname "$0")" && pwd); W=$HOME/.cache/c246; mkdir -p "$W/logs"
next=$W/queue.next; echo 1 >"$next"; INFLIGHT_USD=0.8

spent() {
  python3 -I - "$W/runs" <<'EOF'
import json, sys
from pathlib import Path
total = 0.0
for f in Path(sys.argv[1]).glob("*/result.json"):
    for line in f.read_text().splitlines():
        try:
            total += json.loads(line).get("total_cost_usd") or 0
        except ValueError:
            pass
print(f"{total:.2f}")
EOF
}

lane() {
  while :; do
    line=$(flock "$next" bash -c 'i=$(cat "$1"); sed -n "${i}p" "$2"; echo $((i + 1)) >"$1"' _ "$next" "$queue")
    [ -n "$line" ] || return 0
    read -r set problem key <<<"$line"
    running=$(ls "$W"/logs/*.running 2>/dev/null | wc -l)
    if python3 -I -c 'import sys; sys.exit(float(sys.argv[1]) + float(sys.argv[2]) * int(sys.argv[3]) < float(sys.argv[4]))' \
        "$(spent)" "$INFLIGHT_USD" "$running" "$cap"; then
      echo "cap: not started $key (spent $(spent))"; continue
    fi
    touch "$W/logs/$key.running"
    bash "$H/run_c246.sh" "$set" "$problem" "$key" >"$W/logs/$key.log" 2>&1
    mv "$W/logs/$key.running" "$W/logs/$key.done"
    echo "done $key spent=$(spent) $(tail -1 "$W/logs/$key.log" | head -c 160)"
  done
}

for _ in $(seq 1 "$lanes"); do lane & done
wait
echo "ALL DONE spent=$(spent)"
