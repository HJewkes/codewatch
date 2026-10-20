#!/usr/bin/env bash
# usage: new_arm.sh <problem> <N> <report.txt> <out dir>
# Arm NEW: one headless claude -p session (the solve's binary, model and step limit) on a copy of
# frozen cp(N), prompted with the cp(N) spec plus the prototype report. The copy is a git repo, so
# the session's change is an exact diff against the frozen commit.
set -uo pipefail
problem=$1; n=$2; report=$(realpath "$3"); out=$(realpath -m "$4")
F=/tmp/c239/frozen; P=$HOME/.cache/scbench/problems/$problem
export DOCKER_HOST=unix:///run/user/1000/docker.sock
mkdir -p "$out"; rm -rf "$out/ws"; cp -a "$F/${problem}_cp$n" "$out/ws"
{
  echo "You are maintaining the program in the current directory. Its specification is below, followed by a short"
  echo "code-health report on the change since the previous checkpoint. Address what is warranted in the report and"
  echo "keep every behaviour the specification defines. Use the virtual environment in .venv and keep the tests in"
  echo "tests/ passing (.venv/bin/python -m pytest -q tests). Update NOTES.md if what you change matters to the next"
  echo "checkpoint. Do not commit."
  echo; echo "## Specification"; echo; cat "$P/checkpoint_$n.md"
  echo; echo "## codewatch report"; echo; cat "$report"
} >"$out/prompt.md"
chmod -R a+rwX "$out"
start=$(date +%s)
CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.config/scbench/claude-oauth-token-server")" \
docker run --rm --name "c239-new-$problem-$$" -v "$out/ws:/workspace" -v "$out/prompt.md:/tmp/prompt.md:ro" \
  -w /workspace -e CLAUDE_CODE_OAUTH_TOKEN -e DISABLE_NON_ESSENTIAL_MODEL_CALLS=1 \
  --entrypoint bash codewatch-scbench:a1-cw0.7.0-eaf087f -c '
  git config --global --add safe.directory "*"
  python -m venv .venv >/dev/null && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1
  claude --output-format stream-json --verbose --model claude-sonnet-5-5 --max-turns 100 \
    --permission-mode bypassPermissions --print -- "$(cat /tmp/prompt.md)"; chmod -R a+rwX /workspace 2>/dev/null' >"$out/stdout.jsonl" 2>"$out/stderr.log"
echo "{\"exit\": $?, \"wall_s\": $(( $(date +%s) - start ))}" >"$out/run.json"
python3 -I - "$out/stdout.jsonl" <<'EOF'
import json, sys
for line in open(sys.argv[1]):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("type") == "result":
        print(json.dumps({k: e.get(k) for k in ("subtype", "num_turns", "total_cost_usd", "duration_ms", "is_error")}))
EOF
