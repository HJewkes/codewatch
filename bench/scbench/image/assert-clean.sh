#!/bin/bash
# Build step: arm A1 must never see the SCBench grader (scb-check) or its ast-grep rules.
set -euo pipefail

fail() {
  echo "assert-clean: $1" >&2
  exit 1
}

for cmd in scb-check slop-code ast-grep; do
  if command -v "$cmd" >/dev/null; then fail "$cmd is on PATH"; fi
done
# Debian's shadow utils own /usr/bin/sg (switch group); only ast-grep's sg is a grader tool.
if sg --version 2>&1 | grep -qi ast-grep; then fail "ast-grep's sg is on PATH"; fi

for python in python3 /opt/codewatch-a1/py/bin/python; do
  for module in scb_check slop_code ast_grep_py; do
    if "$python" -c "import $module" 2>/dev/null; then fail "$python can import $module"; fi
  done
done

found="$(find / -xdev \( -iname '*scb[-_]check*' -o -iname '*ast[-_]grep*' -o -iname 'sgconfig.y*ml' -o -iname 'slop_code' \) -print 2>/dev/null)"
if [ -n "$found" ]; then fail "grader files present: $found"; fi

echo "assert-clean: no scb-check, slop-code or ast-grep rule files"
