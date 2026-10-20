#!/usr/bin/env bash
# usage: old_arm.sh <problem> <N> <out dir> <max items>
# Arm OLD on a frozen copy: the bench's after-solve stages at this worktree's code (311ad5d),
# run in the A1 image. cp(N-1) is merged to main, cp(N) is the PR, then commit-ratchet, audit,
# triage and fix. Deviations: no solve-review or synthesis; fix capped at <max items>.
set -uo pipefail
problem=$1; n=$2; out=$(realpath -m "$3"); max=$4
python3 -I "$(cd "$(dirname "$0")/../.." && pwd)/regrade/holdout.py" "$problem" || exit 3
F=/tmp/c239/frozen; P=$HOME/.cache/scbench/problems/$problem
BENCH=$(cd "$(dirname "$0")/../.." && pwd)
export DOCKER_HOST=unix:///run/user/1000/docker.sock
mkdir -p "$out"; rm -rf "$out/ws" "$out/head"
cp -a "$F/${problem}_cp$((n - 1))" "$out/ws"; cp -a "$F/${problem}_cp$n" "$out/head"
rm -rf "$out/ws/.git" "$out/head/.git"; cp "$P/checkpoint_$n.md" "$out/spec.md"
chmod -R a+rwX "$out"
CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.config/scbench/claude-oauth-token-server")" \
docker run --rm --name "c239-old-$problem-$$" -v "$out/ws:/workspace" -v "$out/head:/head:ro" \
  -v "$out/spec.md:/tmp/spec.md:ro" -v "$BENCH:/opt/c239:ro" -w /workspace \
  -e CLAUDE_CODE_OAUTH_TOKEN -e DISABLE_NON_ESSENTIAL_MODEL_CALLS=1 -e CW_CLAUDE_BINARY=claude \
  -e CW_MODEL=claude-sonnet-5-5 -e CW_PERMISSION_MODE=bypassPermissions -e CW_SPEC_FILE=/tmp/spec.md \
  -e N="$n" -e MAX="$max" --entrypoint bash codewatch-scbench:a1-cw0.7.0-eaf087f -c '
  git config --global --add safe.directory "*"
  py="env PYTHONPATH=/opt/c239 /opt/codewatch-a1/py/bin/python -P -m"
  stage() { echo "## $1 $(date -u +%T)"; shift; "$@" | tail -1; }
  stage repo-init env CW_CHECKPOINT=1 $py prflow repo-init --workspace /workspace
  for s in pr-open commit-ratchet pr-merge; do stage "$s-prev" env CW_CHECKPOINT=$((N - 1)) $py prflow $s --workspace /workspace; done
  find /workspace -mindepth 1 -maxdepth 1 ! -name .codewatch -exec rm -rf {} +
  cp -a /head/. /workspace/
  stage pr-open env CW_CHECKPOINT=$N $py prflow pr-open --workspace /workspace
  python -m venv .venv >/dev/null && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1
  stage commit-ratchet env CW_CHECKPOINT=$N $py prflow commit-ratchet --workspace /workspace
  stage audit env CW_CHECKPOINT=$N $py findings.audit_stage --workspace /workspace
  stage triage env CW_CHECKPOINT=$N $py findings.triage_stage --workspace /workspace -- --model claude-sonnet-5-5 \
    --spec /tmp/spec.md --verdicts-dir /workspace/.codewatch --run-id cp-$N
  export CW_STAGE_DEADLINE=$(( $(date +%s) + 5400 ))
  stage fix env CW_CHECKPOINT=$N $py remediation --max-items $MAX \
    --review-command "env PYTHONPATH=/opt/c239 /opt/codewatch-a1/py/bin/python -P -m review --mode fix"
  chmod -R a+rwX /workspace 2>/dev/null; echo "## done $(date -u +%T)"' >"$out/stages.log" 2>&1
echo "exit $?" >>"$out/stages.log"
