#!/bin/bash
# Smoke step, run in the image by build.sh: `graph index --rev HEAD~1` on a copy of the fixture
# whose repository sits under a GIT_DIR outside the work tree, as the PR-flow stages set it up.
set -euo pipefail

work=/tmp/rev-check/work
export GIT_DIR=/tmp/rev-check/repo.git
export GIT_AUTHOR_NAME=agent-x GIT_AUTHOR_EMAIL=agent-x@example.invalid
export GIT_COMMITTER_NAME=agent-x GIT_COMMITTER_EMAIL=agent-x@example.invalid

mkdir -p "$work"
cp -R "$1/." "$work/"
git init -q
git config core.bare false
git config core.worktree "$work"
cd "$work"
git add -A
git commit -qm "fixture"
printf '\n\ndef rev_check_marker():\n    return 1\n' >>shop/pricing.py
git commit -qam "head"
codewatch graph index . --db /tmp/rev-check/graph.db --ref merge-base --rev HEAD~1 --json
