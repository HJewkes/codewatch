#!/usr/bin/env bash
# usage: freeze_c241.sh <suite problem> <N> [<suite problem> <N> ...]
# C-241: frozen git copies of every checkpoint the NEW-C arm needs, under /tmp/c241/frozen.
# cs and etl cp2/cp3 are links to the C-239 copies; cp1 bases and each unseen problem's cp(N-1)
# and cp(N) come from the suite seeds.
set -euo pipefail
python3 -I "$(cd "$(dirname "$0")/../.." && pwd)/regrade/holdout.py" code_search etl_pipeline $(printf '%s\n' "$@" | awk 'NR % 2') || exit 3
F=/tmp/c241/frozen; A=$HOME/.local/share/codewatch-scbench/seeds/c209-a1a
S=$HOME/.local/share/codewatch-scbench/seeds/c209-suite
mkdir -p "$F"
freeze() { # <seed checkpoint dir> <dest>
  rm -rf "$2"; cp -a "$1/snapshot" "$2"; chmod -R u+w "$2"
  git -C "$2" init -q; git -C "$2" add -A
  git -C "$2" -c "user.name=c241" -c "user.email=c241@local" commit -qm "seed $(basename "$2")"
  echo "$2 $(git -C "$2" rev-parse --short HEAD)"
}
freeze "$A/code_search/checkpoint_1" "$F/code_search_cp1"
freeze "$A/etl_pipeline/checkpoint_1" "$F/etl_pipeline_cp1"
while [ $# -ge 2 ]; do
  freeze "$S/$1/checkpoint_$(($2 - 1))" "$F/${1}_cp$(($2 - 1))"; freeze "$S/$1/checkpoint_$2" "$F/${1}_cp$2"; shift 2
done
for p in code_search etl_pipeline; do
  for n in 2 3; do ln -sfn "/tmp/c239/frozen/${p}_cp$n" "$F/${p}_cp$n"; done
done
