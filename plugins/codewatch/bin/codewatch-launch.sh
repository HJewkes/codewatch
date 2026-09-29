#!/usr/bin/env bash
# Launch the codewatch MCP server for the codewatch Claude Code plugin.
#
# Claude Code copies an installed plugin into ~/.claude/plugins/cache and will
# not resolve paths outside that copy, so this shim finds the real CLI at spawn
# time instead of bundling it.
#
# A user-scope install starts this in every repo the owner opens. Read commands
# in the CLI fail without .codewatch/graph.db, so the shim
# refuses to call the CLI at all unless <repo root>/.codewatch/graph.db exists.
# An unindexed repo then shows the server as failed in /mcp, which is honest and
# costs no model tokens.
#
# CLI resolution (first hit wins):
#   1. $CODEWATCH_BIN  - a command name or path; a .js/.mjs path runs under node
#   2. codewatch on PATH
# There is deliberately no npx fallback: `npx -y` costs 1-3 s per spawn.
#
# node is resolved defensively because PATH is not dependable at spawn: a login
# shell whose `brew shellenv` failed starts Claude Code without homebrew on PATH.
# The resolved node directory is prepended to PATH so an `env node` shebang works.
#
# stdout is the MCP stdio transport, so every diagnostic goes to stderr.

set -euo pipefail

fail() {
  echo "codewatch: $1" >&2
  exit 1
}

resolve_repo_root() {
  local project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
  git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null ||
    fail "$project_dir is not inside a git repository"
}

resolve_node() {
  local candidate
  for candidate in "$(command -v node 2>/dev/null || true)" \
    /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

repo_root="$(resolve_repo_root)"
db="$repo_root/.codewatch/graph.db"
[ -f "$db" ] || fail "no .codewatch/graph.db under $repo_root; run \`codewatch graph index .\`"

if node_bin="$(resolve_node)"; then
  PATH="$(dirname "$node_bin"):$PATH"
  export PATH
fi

cli="${CODEWATCH_BIN:-codewatch}"
mcp_args=(graph mcp --db "$db" --repo-root "$repo_root")

case "$cli" in
  *.js | *.mjs)
    [ -f "$cli" ] || fail "CODEWATCH_BIN points at $cli, which does not exist"
    [ -n "${node_bin:-}" ] || fail "cannot find node to run $cli (PATH: $PATH)"
    exec "$node_bin" "$cli" "${mcp_args[@]}"
    ;;
esac

command -v "$cli" >/dev/null 2>&1 || fail "cannot find the codewatch CLI ($cli).
Install it with \`npm i -g @codewatch/cli\`, or set CODEWATCH_BIN to its path."

exec "$cli" "${mcp_args[@]}"
