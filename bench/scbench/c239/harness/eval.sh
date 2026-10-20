#!/usr/bin/env bash
# usage: eval.sh <problem> <checkpoint N> <workspace dir> <out dir>
# Hidden-test evaluation of a frozen copy, as the bench runs it: uv init, uv add -r requirements.txt,
# then pytest laid out and invoked as the pinned runner does (evalprep.py), with --entrypoint "uv run <entry>.py".
# The only addition is a 600 s per-test safety timeout; the runner sets none.
set -uo pipefail
problem=$1; n=$2; ws=$(realpath "$3"); out=$(realpath -m "$4")
python3 -I "$(cd "$(dirname "$0")/../.." && pwd)/regrade/holdout.py" "$problem" || exit 3
export DOCKER_HOST=unix:///run/user/1000/docker.sock
P=$HOME/.cache/scbench/problems/$problem
mkdir -p "$out"; rm -rf "$out/ws"; cp -a "$ws" "$out/ws"; rm -rf "$out/ws/.git" "$out/ws/.venv" "$out/ws/.codewatch" "$out/ws/.evaluation_tests"
eval "$(python3 -I "$(dirname "$0")/evalprep.py" "$P" "$n" "$out/ws")"
eval "envs=($ENV)"
entry=$(awk '/^entry_file:/{print $2}' "$P/config.yaml")
docker run --rm --name "c239-eval-$problem-$$" -v "$out/ws:/workspace" -w /workspace "${envs[@]}" \
  -e UV_CACHE_DIR=/tmp/uv-cache --user 0:0 ghcr.io/astral-sh/uv:python3.12-trixie-slim sh -c "
  uv init -q >/dev/null 2>&1; uv add -q -r requirements.txt >/dev/null 2>&1;
  uvx $WITH pytest --timeout=600 --entrypoint='uv run $entry.py' --checkpoint=checkpoint_$n \
    --confcutdir=.evaluation_tests --json-report --json-report-file=/workspace/.report.json -rN .evaluation_tests;
  chmod -R a+rwX /workspace 2>/dev/null" >"$out/pytest.txt" 2>&1
python3 -I - "$out/ws/.report.json" "$out/summary.json" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
tests = r.get("tests", [])
failed = sorted(t["nodeid"] for t in tests if t["outcome"] != "passed")
s = {"passed": len(tests) - len(failed), "total": len(tests), "failed": failed}
json.dump(s, open(sys.argv[2], "w"), indent=1)
print(json.dumps({"passed": s["passed"], "total": s["total"], "failed": [f.split("::")[-1] for f in failed]}))
EOF
