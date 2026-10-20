#!/usr/bin/env bash
# usage: diffgate.sh <problem> <N> <base dir> <head dir> <out dir> [regrade.json] [waivers.json]
# C-242 behaviour-differential gate for a cleanup change. In one container (the A1 image): record
# every CLI call that base's visible tests/ and the hidden tests for checkpoints 1..N make against
# base, add generated JSON variants, replay all of it on base twice and on head once; then the
# verdict (bench/scbench/diffgate/compare.py has the normalisation and spec-required rules).
set -uo pipefail
problem=$1; n=$2; base=$(realpath "$3"); head=$(realpath "$4"); out=$(realpath -m "$5")
BENCH=$(cd "$(dirname "$0")/../.." && pwd)
python3 -I "$BENCH/regrade/holdout.py" "$problem" || exit 3
regrade=${6:-}; waivers=${7:-}
P=$HOME/.cache/scbench/problems/$problem
export DOCKER_HOST=unix:///run/user/1000/docker.sock
entry=$(awk '/^entry_file:/{print $2}' "$P/config.yaml").py
w=$out/work; rm -rf "$w"; mkdir -p "$w/cases"
for side in rec a b; do
  src=$base; [ "$side" = b ] && src=$head
  rsync -a --exclude .git --exclude .venv --exclude venv --exclude .codewatch --exclude __pycache__ \
    --exclude .pytest_cache "$src/" "$w/$side/"
  mkdir -p "$w/$side/.evaluation_tests"; cp -a "$P/tests/." "$w/$side/.evaluation_tests/"
done
hidden=""; for k in $(seq 1 "$n"); do hidden="$hidden .evaluation_tests/test_checkpoint_$k.py"; done
chmod -R a+rwX "$w"
docker run --rm --name "c242-diffgate-$problem-$$" -v "$w:/work" -v "$BENCH/diffgate:/opt/dg/diffgate:ro" \
  -w /work/rec -e ENTRY="$entry" -e HIDDEN="$hidden" -e N="$n" \
  --entrypoint bash codewatch-scbench:a1-cw0.7.0-eaf087f -c '
  python -m venv /tmp/venv >/dev/null && /tmp/venv/bin/pip install -q -r /work/a/requirements.txt pytest >/dev/null 2>&1
  rec() { DIFFGATE_SOURCE=$1 PYTHONPATH=/opt/dg/diffgate/recorder DIFFGATE_CASES=/work/cases DIFFGATE_ROOT=/work/rec \
    DIFFGATE_ENTRY=$ENTRY /tmp/venv/bin/python -m pytest -q -p diffgate_recorder -p no:cacheprovider "${@:2}"; }
  rec tests tests >/work/record_tests.log 2>&1
  rec hidden $HIDDEN --entrypoint "/tmp/venv/bin/python /work/rec/$ENTRY" --checkpoint checkpoint_$N >/work/record_hidden.log 2>&1
  /tmp/venv/bin/python -I -c "import sys; sys.path.insert(0, \"/opt/dg\"); from diffgate.__main__ import main; sys.exit(main())" \
    replay --cases /work/cases --generate --base /work/a --head /work/b --python /tmp/venv/bin/python \
    --scratch /tmp/dg --out /work/runs.json
  chmod -R a+rwX /work 2>/dev/null' >"$out/replay.log" 2>&1
args=(verdict --cases "$w/cases" --runs "$w/runs.json" --out "$out/gate.json" --spec-dir "$P")
[ -n "$regrade" ] && args+=(--regrade "$regrade")
[ -n "$waivers" ] && args+=(--waivers "$waivers")
python3 -I -c 'import sys; sys.path.insert(0, sys.argv.pop(1)); from diffgate.__main__ import main; sys.exit(main())' \
  "$BENCH" "${args[@]}"
