#!/usr/bin/env bash
# usage: post.sh <problem> <N> <run dir>
# After an arm: metrics, hidden-test score, the prototype report re-run on the result, exact diff.
set -uo pipefail
problem=$1; n=$2; run=$(realpath "$3"); k=${problem%%_*}; [ "$k" = etl ] || k=cs
python3 -I "$(cd "$(dirname "$0")/../.." && pwd)/regrade/holdout.py" "$problem" || exit 3
C=/tmp/c239; S=$(cd "$(dirname "$0")" && pwd); R=$S/../report.py
bash $S/measure.sh "$run/ws" "$run/meas" >/dev/null
bash $S/eval.sh "$problem" "$n" "$run/ws" "$run/eval" >/dev/null
b=$C/meas/${k}$((n - 1))_base/ws; h=$run/meas/ws
python3 -I $R "$b" "$h" --findings "$h/.codewatch/audit/findings.jsonl" --base-db "$b/.codewatch/graph.db" \
  --head-db "$h/.codewatch/graph.db" --json "$run/report_after.json" >"$run/report_after.txt"
diff -ruN -x .git -x .venv -x venv -x .codewatch -x __pycache__ -x .pytest_cache -x .ruff_cache \
  "$C/frozen/${problem}_cp$n" "$run/ws" >"$run/change.diff"
python3 -I - "$run" <<'EOF'
import json, sys
run = sys.argv[1]
diff = open(f"{run}/change.diff", errors="replace").read().splitlines()
files = sorted({l.split()[1].split("/ws/", 1)[-1] for l in diff if l.startswith("+++ ") and "/ws/" in l})
add = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
rem = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
out = {"metrics": json.load(open(f"{run}/meas/metrics.json")), "eval": json.load(open(f"{run}/eval/summary.json")),
       "report_after_count": json.load(open(f"{run}/report_after.json"))["count"],
       "diff": {"files": files, "added": add, "removed": rem}}
json.dump(out, open(f"{run}/post.json", "w"), indent=1)
m, e = out["metrics"], out["eval"]
print(json.dumps({"pass": f"{e['passed']}/{e['total']}", "src": m["src_loc"], "test_loc": m["test_loc"],
                  "test_fns": m["test_fns"], "ratio": m["test_src_ratio"], "cog_max": m.get("cog_max"),
                  "cog_mean": m.get("cog_mean"), "single_caller": m.get("single_caller"), "clones": m.get("clones"),
                  "findings": m.get("findings"), "report_after": out["report_after_count"], "diff": f"+{add}/-{rem}",
                  "failed": [f.split("::")[-1] for f in e["failed"]]}))
EOF
