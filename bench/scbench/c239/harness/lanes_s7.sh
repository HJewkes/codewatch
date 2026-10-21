#!/usr/bin/env bash
# usage: lanes_s7.sh <queue file> <workers> <cap USD> <max usd per seed> [max load5]
# C-248 S7 driver: <workers> workers take "<seed set> <problem> <key>" lines from the queue in order and
# run run_s7.sh on each (the runner itself runs up to 4 lanes). A worker claims a seed by creating
# ~/.cache/c248-s7/claims/<key>, so a rerun skips seeds already claimed. Before a seed it waits while
# load5 is at or above the limit (default 28) or <workers> run_s7.sh are alive on the host (any driver's),
# and it starts no seed once the finished runs' total_cost_usd plus one seed's cap per running seed
# reaches <cap USD>. A holdout seed is refused by
# the guard (exit 3) and counted, never named. Logs go to ~/.cache/c248-s7/logs/<key>.log.
set -uo pipefail
queue=$(realpath "$1"); workers=$2; cap=$3; per_seed=$4; max_load=${5:-28}
H=$(cd "$(dirname "$0")" && pwd); W=$HOME/.cache/c248-s7; mkdir -p "$W/logs" "$W/runs" "$W/claims"

spent() {
  python3 -I - "$W/runs" <<'EOF'
import json, sys
from pathlib import Path
def usd(f):
    try:
        return json.loads(f.read_text()).get('total_cost_usd') or 0
    except ValueError:
        return 0  # a crashed runner leaves result.json empty; its seed is rerun
print(f"{sum(usd(f) for f in Path(sys.argv[1]).glob('*/result.json')):.2f}")
EOF
}

alive() { pgrep -fc 'c239/harness/run_s7\.sh' || true; }

under_cap() {
  local running
  running=$(alive)
  python3 -I -c 'import sys; sys.exit(float(sys.argv[1]) + float(sys.argv[2]) * (int(sys.argv[3]) + 1) >= float(sys.argv[4]))' \
    "$(spent)" "$per_seed" "$running" "$cap"
}

worker() {
  while read -r set problem key <&3; do
    [ -n "$key" ] || continue
    mkdir "$W/claims/$key" 2>/dev/null || continue
    if ! python3 -I "$H/../../regrade/holdout.py" "$problem" 2>/dev/null; then
      echo "holdout refused"; continue
    fi
    under_cap || { echo "cap: not started $key (spent $(spent))"; continue; }
    while [ "$(alive)" -ge "$workers" ] ||
        python3 -I -c 'import os, sys; sys.exit(os.getloadavg()[1] < float(sys.argv[1]))' "$max_load"; do sleep 60; done
    touch "$W/logs/$key.running"
    bash "$H/run_s7.sh" "$set" "$problem" "$key" "$per_seed" >"$W/logs/$key.log" 2>&1
    rc=$?
    rm -f "$W/logs/$key.running"
    echo "done $key rc=$rc spent=$(spent) load=$(cut -d' ' -f2 /proc/loadavg)"
  done 3<"$queue"
}

for _ in $(seq 1 "$workers"); do worker & sleep 5; done
wait
echo "ALL DONE spent=$(spent)"
