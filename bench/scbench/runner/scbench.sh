#!/usr/bin/env bash
# usage: scbench gate --cluster <task id>
# The cleanup session's one codewatch tool (C-248 S6): the S4 self-check, `python3 -m gate --cluster`,
# against the frozen wave base and the run's plan. gate/ logs only the calls it grants, so a call it
# refuses (exit 2: budget spent or unknown task) is counted here, one line per refusal, in
# $CW_GATE_REFUSED; the runner passes that count to the ledger as `refused`.
set -uo pipefail
[ "${1:-}" = gate ] || { echo "usage: scbench gate --cluster <task id>" >&2; exit 64; }
shift
PYTHONPATH=$CW_GATE_LIB python3 -P -m gate "$@" --base "$CW_GATE_BASE" --workspace "$PWD" \
  --plan "$CW_GATE_PLAN" --calls "$CW_GATE_CALLS"
rc=$?
[ "$rc" -eq 2 ] && echo refused >>"$CW_GATE_REFUSED"
exit "$rc"
