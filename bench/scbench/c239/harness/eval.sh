#!/usr/bin/env bash
# usage: eval.sh <problem> <checkpoint N> <workspace dir> <out dir>
# Hidden-test evaluation of a frozen copy, as the bench runs it: uv init, uv add -r requirements.txt,
# pytest over test_checkpoint_1..N with --entrypoint "uv run <entry>.py".
set -uo pipefail
problem=$1; n=$2; ws=$(realpath "$3"); out=$(realpath -m "$4")
python3 -I "$(cd "$(dirname "$0")/../.." && pwd)/regrade/holdout.py" "$problem" || exit 3
export DOCKER_HOST=unix:///run/user/1000/docker.sock
P=$HOME/.cache/scbench/problems/$problem
mkdir -p "$out"; rm -rf "$out/ws"; cp -a "$ws" "$out/ws"; rm -rf "$out/ws/.git" "$out/ws/.venv" "$out/ws/.codewatch"
mkdir -p "$out/ws/.evaluation_tests"; cp -a "$P/tests/." "$out/ws/.evaluation_tests/"
entry=$(awk '/^entry_file:/{print $2}' "$P/config.yaml")
files=""; for k in $(seq 1 "$n"); do files="$files .evaluation_tests/test_checkpoint_$k.py"; done
cat >"$out/ws/pytest.ini" <<EOF
[pytest]
timeout = 10
EOF
docker run --rm --name "c239-eval-$problem-$$" -v "$out/ws:/workspace" -w /workspace \
  -e UV_CACHE_DIR=/tmp/uv-cache --user 0:0 ghcr.io/astral-sh/uv:python3.12-trixie-slim sh -c "
  uv init -q >/dev/null 2>&1; uv add -q -r requirements.txt >/dev/null 2>&1;
  uv add -q pytest pytest-timeout pytest-json-report >/dev/null 2>&1;
  uv run pytest -q -p no:cacheprovider $files --entrypoint 'uv run $entry.py' --checkpoint checkpoint_$n \
    --json-report --json-report-file=/workspace/.report.json -rN; chmod -R a+rwX /workspace 2>/dev/null" >"$out/pytest.txt" 2>&1
python3 -I - "$out/ws/.report.json" "$out/summary.json" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
tests = r.get("tests", [])
failed = sorted(t["nodeid"] for t in tests if t["outcome"] != "passed")
s = {"passed": len(tests) - len(failed), "total": len(tests), "failed": failed}
json.dump(s, open(sys.argv[2], "w"), indent=1)
print(json.dumps({"passed": s["passed"], "total": s["total"], "failed": [f.split("::")[-1] for f in failed]}))
EOF
