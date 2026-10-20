#!/usr/bin/env bash
# usage: newc_arm.sh <problem> <N> <report.txt> <targets.txt> <out dir>
# C-241 arm NEW-C: arm NEW (one headless claude -p session on a copy of frozen cp(N)) with every
# spec cp1..N, a complexity goal on the targets, and the C-238 guardrails stated as hard rules.
set -uo pipefail
problem=$1; n=$2; report=$(realpath "$3"); targets=$(realpath "$4"); out=$(realpath -m "$5")
python3 -I "$(cd "$(dirname "$0")/../.." && pwd)/regrade/holdout.py" "$problem" || exit 3
F=/tmp/c241/frozen; P=$HOME/.cache/scbench/problems/$problem
export DOCKER_HOST=unix:///run/user/1000/docker.sock
mkdir -p "$out"; rm -rf "$out/ws"; cp -aL "$F/${problem}_cp$n" "$out/ws"
{
  cat <<EOF
You are maintaining the program in the current directory. Below are the specifications of every
checkpoint so far (1 to $n; checkpoint $n is the current one). Behaviour an earlier checkpoint defines
still holds unless a later checkpoint changes it. After them come a short code-health report on the
change since the previous checkpoint and a list of complexity targets.

Your task:
1. Address what is warranted in the report, keeping every behaviour the specifications define. If no
   specification decides a case, leave the behaviour as it is and note the open question in NOTES.md.
   Do not pin a guess with a test.
2. Complexity goal: reduce the real complexity of the complexity targets. Simplify conditionals, remove
   duplicated branches and repeated checks, replace hand-written case analysis with data tables or
   standard-library facilities, and merge paths that do the same thing. Do NOT meet the goal by moving
   code into new helper functions that have only one caller: that moves complexity, it does not remove
   it. A new helper is acceptable only when it has two or more callers or replaces duplicated code.

Hard rules. They are checked mechanically after you finish, and a change that breaks one is rejected:
- Behaviour: every test in tests/ still passes, and no input produces a different result unless a
  specification requires it.
- Size: in non-test source, net added lines must be at most 10, or at most 25% of the lines you
  removed, unless the total cyclomatic complexity of the source goes down.
- Helpers: the number of functions with exactly one caller must not go up.
- Tests: test lines must stay at most 2.0x the source lines and at most twice the current ratio. Add a
  test only to pin behaviour you changed.

Use the virtual environment in .venv and keep the tests passing (.venv/bin/python -m pytest -q tests).
Update NOTES.md if what you change matters to the next checkpoint. Do not commit.
EOF
  for k in $(seq 1 "$n"); do echo; echo "## Specification, checkpoint $k"; echo; cat "$P/checkpoint_$k.md"; done
  echo; echo "## codewatch report"; echo
  sed 's/Readability only; split only if a finding above needs it\./See the complexity targets./' "$report"
  echo; echo "## Complexity targets"; echo; cat "$targets"
} >"$out/prompt.md"
chmod -R a+rwX "$out"
start=$(date +%s)
CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.config/scbench/claude-oauth-token-server")" \
docker run --rm --name "c241-newc-$problem-$$" -v "$out/ws:/workspace" -v "$out/prompt.md:/tmp/prompt.md:ro" \
  -w /workspace -e CLAUDE_CODE_OAUTH_TOKEN -e DISABLE_NON_ESSENTIAL_MODEL_CALLS=1 \
  --entrypoint bash codewatch-scbench:a1-cw0.7.0-eaf087f -c '
  git config --global --add safe.directory "*"
  python -m venv .venv >/dev/null && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1
  claude --output-format stream-json --verbose --model claude-sonnet-5-5 --max-turns 100 \
    --permission-mode bypassPermissions --print -- "$(cat /tmp/prompt.md)"; chmod -R a+rwX /workspace 2>/dev/null' >"$out/stdout.jsonl" 2>"$out/stderr.log"
echo "{\"exit\": $?, \"wall_s\": $(( $(date +%s) - start ))}" >"$out/run.json"
python3 -I - "$out/stdout.jsonl" <<'EOF' | tee "$out/result.json"
import json, sys
for line in open(sys.argv[1]):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("type") == "result":
        print(json.dumps({k: e.get(k) for k in ("subtype", "num_turns", "total_cost_usd", "duration_ms", "is_error")}))
EOF
