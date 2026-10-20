#!/usr/bin/env bash
# usage: prep_c246.sh <seed set> <problem> <key>
# C-246 phase A (no model calls): copy the seed's final checkpoint N and its base N-1 to
# /tmp/c246/seeds, freeze both as git repos, measure both (under ~/.cache/c246, venvs pruned), write the change-tied report and the
# complexity targets for N-1 -> N, then a no-op regrade of frozen N against its seed. The base is
# evaluable when that regrade reproduces the seed's evaluation.json hidden counts (parity.hidden_ok).
# Writes /tmp/c246/prep/<key>.json.
set -uo pipefail
set=$1; problem=$2; key=$3
H=$(cd "$(dirname "$0")" && pwd); BENCH=$(cd "$H/../.." && pwd)
python3 -I "$BENCH/regrade/holdout.py" "$problem" || exit 3
R=/tmp/c246; src=$HOME/.local/share/codewatch-scbench/seeds/$set/$problem
n=$(ls -d "$src"/checkpoint_* | sed 's/.*_//' | sort -n | tail -1); b=$((n - 1))
seed=$R/seeds/$set/$problem; F=$R/frozen/$set; M=$HOME/.cache/c246/meas/$key; mkdir -p "$seed" "$F" "$M" "$R/reports" "$R/prep"
for k in "$b" "$n"; do
  rm -rf "$seed/checkpoint_$k"; cp -a "$src/checkpoint_$k" "$seed/"; chmod -R u+w "$seed/checkpoint_$k"
  d=$F/${problem}_cp$k; rm -rf "$d"; cp -a "$seed/checkpoint_$k/snapshot" "$d"
  git -C "$d" init -q; git -C "$d" add -A
  git -C "$d" -c user.name=c246 -c user.email=c246@local commit -qm "seed ${problem}_cp$k"
done
bash "$H/measure.sh" "$F/${problem}_cp$b" "$M/base" >/dev/null
bash "$H/measure.sh" "$F/${problem}_cp$n" "$M/head" >/dev/null
rm -rf "$M/base/ws/.venv" "$M/head/ws/.venv"
bw=$M/base/ws; hw=$M/head/ws
python3 -I "$H/../report.py" "$bw" "$hw" --findings "$hw/.codewatch/audit/findings.jsonl" \
  --base-db "$bw/.codewatch/graph.db" --head-db "$hw/.codewatch/graph.db" --json "$R/reports/$key.json" \
  >"$R/reports/$key.txt"
python3 -I "$H/targets.py" "$bw" "$hw" "$hw/.codewatch/graph.db" >"$R/reports/${key}_targets.txt"
python3 -I -c 'import sys; sys.path.insert(0, sys.argv.pop(1)); from regrade.__main__ import main; sys.exit(main())' \
  "$BENCH" --problem "$problem" --checkpoint "$n" --base "$seed/checkpoint_$n" --head "$F/${problem}_cp$n" \
  --label "${key}_noop" --out "$M/parity.json" --scratch "$M/scratch" >/dev/null
rm -rf "$M/scratch"
python3 -I - "$set" "$problem" "$key" "$n" "$M" "$R/reports/${key}_targets.txt" "$R/prep/$key.json" <<'EOF'
import json, sys
from pathlib import Path
set_, problem, key, n, meas, targets, out = sys.argv[1:8]
reasons = []
for side in ("base", "head"):
    m = Path(meas, side, "metrics.json")
    if not m.is_file() or not json.loads(m.read_text() or "{}").get("audited"):
        reasons.append(f"{side} audit/measure failed")
try:
    p = json.loads(Path(meas, "parity.json").read_text())
    hidden = p["before"].get("hidden") or {}
    if not hidden.get("total"):
        reasons.append("hidden eval ran no tests")
    elif p["parity"]["hidden_ok"] is False:
        reasons.append("hidden rerun does not reproduce evaluation.json")
except (OSError, ValueError, KeyError) as error:
    reasons.append(f"no-op regrade failed ({type(error).__name__})")
info = {"set": set_, "problem": problem, "key": key, "n": int(n), "evaluable": not reasons, "reasons": reasons,
        "targets": sum(1 for l in Path(targets).read_text().splitlines() if l.startswith("- "))}
Path(out).write_text(json.dumps(info) + "\n")
print(json.dumps(info))
EOF
