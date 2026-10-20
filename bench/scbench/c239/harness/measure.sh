#!/usr/bin/env bash
# usage: measure.sh <workspace dir> <out dir>
# Full bench audit (findings.audit_stage at this worktree's code) on a scratch copy, then metrics.json.
set -uo pipefail
ws=$(realpath "$1"); out=$(realpath -m "$2")
export DOCKER_HOST=unix:///run/user/1000/docker.sock
BENCH=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$out"; rm -rf "$out/ws"; cp -a "$ws" "$out/ws"; rm -rf "$out/ws/.git" "$out/ws/.codewatch" "$out/ws/.venv"
chmod -R a+rwX "$out/ws"
docker run --rm --name "c239-measure-$$" -v "$out/ws:/workspace" -v "$BENCH:/opt/c239:ro" -w /workspace \
  --entrypoint sh codewatch-scbench:a1-cw0.7.0-eaf087f -c '
  git config --global --add safe.directory "*"; git init -q . && git add -A && git -c user.name=m -c user.email=m@l commit -qm m;
  python -m venv .venv >/dev/null && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1;
  PYTHONPATH=/opt/c239 /opt/codewatch-a1/py/bin/python -P -m findings.audit_stage --workspace /workspace; chmod -R a+rwX /workspace 2>/dev/null' \
  >"$out/audit.log" 2>&1
python3 -I "$BENCH/c239/harness/metrics.py" "$out/ws" >"$out/metrics.json" && cat "$out/metrics.json"
