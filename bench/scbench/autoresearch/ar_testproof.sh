#!/usr/bin/env bash
# usage: ar_testproof.sh <base rev> <head rev>   (run from the idea tree)
# The autoresearch test proof (C-256): the test modules <head> adds or changes under bench/scbench/tests
# must fail on <base>'s code and pass on <head>'s. Both trees are exported with git archive to a scratch
# dir (no worktree, no checkout), and head's versions of the test files are laid over base. Prints one
# ar-testproof/v1 line; exit 0 only when base fails and head passes, 1 when the proof fails, 2 with no test.
set -uo pipefail
base=$1; head=$2
top=$(git rev-parse --show-toplevel) || exit 2
mapfile -t tests < <(git -C "$top" diff --name-only --diff-filter=AM "$base" "$head" -- 'bench/scbench/tests/test_*.py')
[ "${#tests[@]}" -gt 0 ] || { echo '{"schema": "ar-testproof/v1", "pass": false, "reason": "no test added or changed"}'; exit 2; }
scratch=$(mktemp -d "${TMPDIR:-/tmp}/ar-testproof.XXXXXX"); trap 'rm -rf "$scratch"' EXIT
modules=()
for t in "${tests[@]}"; do rel=${t#bench/scbench/}; m=${rel%.py}; modules+=("${m//\//.}"); done

suite() {  # <rev> <dir>: export <rev>, lay head's tests over it, run them; -> the unittest exit code
  mkdir -p "$2"; git -C "$top" archive "$1" bench/scbench | tar -x -C "$2"
  for t in "${tests[@]}"; do git -C "$top" show "$head:$t" >"$2/$t"; done
  (cd "$2/bench/scbench" && python3 -m unittest -q "${modules[@]}" >/dev/null 2>&1)
}

suite "$base" "$scratch/base"; base_rc=$?
suite "$head" "$scratch/head"; head_rc=$?
ok=false; [ "$base_rc" -ne 0 ] && [ "$head_rc" -eq 0 ] && ok=true
python3 -I -c 'import json, sys; print(json.dumps({"schema": "ar-testproof/v1", "tests": sys.argv[4:], "base_rc": int(sys.argv[1]),
  "head_rc": int(sys.argv[2]), "pass": sys.argv[3] == "true"}))' "$base_rc" "$head_rc" "$ok" "${tests[@]}"
[ "$ok" = true ]
