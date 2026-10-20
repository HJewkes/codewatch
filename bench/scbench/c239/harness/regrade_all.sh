#!/usr/bin/env bash
# usage: regrade_all.sh <out dir>
# C-240: no-op regrades of the 4 frozen C-239 checkpoints against their seeds (parity with the
# A1a run's recorded scores), then every C-239 arm output against its cp3 seed.
set -uo pipefail
out=$(realpath -m "$1"); mkdir -p "$out"
BENCH=$(cd "$(dirname "$0")/../.." && pwd)
SEEDS=$HOME/.local/share/codewatch-scbench/seeds/c209-a1a
RECORDED=$HOME/.cache/codewatch-scbench/runs/A1a/20261019T172927Z/run/checkpoint_results.jsonl
C=/tmp/c239
regrade() { # <label> <problem> <N> <head>
  python3 -I -c 'import sys; sys.path.insert(0, sys.argv.pop(1)); from regrade.__main__ import main; sys.exit(main())' \
    "$BENCH" --problem "$2" --checkpoint "$3" --base "$SEEDS/$2/checkpoint_$3" --head "$4" \
    --recorded "$RECORDED" --label "$1" --out "$out/$1.json" --scratch "$out/scratch" | tee -a "$out/table.md"
}
for p in code_search etl_pipeline; do
  for n in 2 3; do regrade "${p}_cp${n}_noop" "$p" "$n" "$C/frozen/${p}_cp$n"; done
done
for run in "$C"/runs/*/; do
  name=$(basename "$run"); case $name in *etl*) p=etl_pipeline ;; *) p=code_search ;; esac
  regrade "$name" "$p" 3 "$run/ws"
done
rm -rf "$out/scratch"
