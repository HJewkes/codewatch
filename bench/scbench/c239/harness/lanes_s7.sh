#!/usr/bin/env bash
# usage: lanes_s7.sh <queue file> <cap USD> <max usd per seed> [max load5]
# C-248 S7 driver: run_s7.sh on each "<seed set> <problem> <key>" line in order, one seed at a time
# (the runner itself runs up to 4 lanes). Before a seed it waits while load5 is at or above the limit
# (default 28), and stops starting seeds once the finished runs' total_cost_usd plus one seed's cap
# reaches <cap USD>. A holdout seed is refused by the guard (exit 3) and counted, never named.
# Logs go to ~/.cache/c248-s7/logs/<key>.log.
set -uo pipefail
queue=$(realpath "$1"); cap=$2; per_seed=$3; max_load=${4:-28}
H=$(cd "$(dirname "$0")" && pwd); W=$HOME/.cache/c248-s7; mkdir -p "$W/logs" "$W/runs"
refused=0

spent() {
  python3 -I - "$W/runs" <<'EOF'
import json, sys
from pathlib import Path
print(f"{sum(json.loads(f.read_text()).get('total_cost_usd') or 0 for f in Path(sys.argv[1]).glob('*/result.json')):.2f}")
EOF
}

while read -r set problem key <&3; do
  [ -n "$key" ] || continue
  [ -f "$W/runs/$key/cleanup.json" ] && { echo "skip $key (scored)"; continue; }
  if ! python3 -I "$H/../../regrade/holdout.py" "$problem" 2>/dev/null; then
    refused=$((refused + 1)); continue
  fi
  if ! python3 -I -c 'import sys; sys.exit(float(sys.argv[1]) + float(sys.argv[2]) >= float(sys.argv[3]))' \
      "$(spent)" "$per_seed" "$cap"; then
    echo "cap: not started $key (spent $(spent))"; continue
  fi
  while python3 -I -c 'import os, sys; sys.exit(os.getloadavg()[1] < float(sys.argv[1]))' "$max_load"; do sleep 60; done
  bash "$H/run_s7.sh" "$set" "$problem" "$key" "$per_seed" >"$W/logs/$key.log" 2>&1
  echo "done $key rc=$? spent=$(spent) load=$(cut -d' ' -f2 /proc/loadavg)"
done 3<"$queue"
echo "ALL DONE spent=$(spent) holdout_refused=$refused"
