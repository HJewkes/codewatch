# codewatch Claude Code plugin

Gives Claude Code a budgeted snapshot of your repo's code graph at session start, bundles the
codewatch MCP server, and offers an opt-in Grep augment that names files a grep misses
because they reach a symbol only through re-export barrels.

## What it ships

- A **SessionStart hook** (`startup|clear|compact`) that injects a short repo snapshot as
  additional context. It exits silently when the repo is not indexed or the CLI is missing.
  It also appends the carried notes, capped at about 1.5k tokens:
  - the taste lines in `.codewatch/taste.md` plus any unmerged `.codewatch/taste.d/*.md`
    fragments, each line keeping its provenance tag;
  - at most 3 open review items: confirmed test gaps from `.codewatch/verdicts.jsonl` plus
    `.codewatch/verdicts.d/*.jsonl` (a later fragment row replaces the row with its key),
    then the new violations in `.codewatch/session-brief.json`, then other confirmed findings;
  - the most-imported changed symbols from `session-brief.json`, a derived file that is
    never committed.

  Those notes are injected even outside a git repository and when the snapshot itself
  fails. With none of these files, the output is the snapshot alone.
- The **codewatch MCP server** (`graph mcp`), launched by `bin/codewatch-launch.sh`. It
  refuses to start in a repo without `.codewatch/graph.db`, so an unindexed repo shows the
  server as failed in `/mcp` and costs no model tokens.
- An **opt-in PostToolUse hook** for `Grep` (see [Grep augment](#grep-augment-opt-in)).

## Prerequisites

1. The `codewatch` CLI on `PATH`: `npm i -g @codewatch/cli`.
2. Index each repo once: `codewatch graph index .` (writes `.codewatch/graph.db`).
3. Optional: `codewatch graph embed` plus a running [Ollama](https://ollama.com) enables
   `find_similar` (similar-capability search). Without them the other tools still work.

## Install

<!-- install:start -->
```bash
# one-time: register this repo as a local marketplace
claude plugin marketplace add ~/projects/codewatch
# install the plugin
claude plugin install codewatch@codewatch-local
```
<!-- install:end -->

Use the path of your own checkout in place of `~/projects/codewatch`.

## Grep augment (opt-in)

Off by default. After a `Grep` for a plain identifier that is exported through a barrel, it
appends the importers the search did not already return. Regex patterns are skipped, and it
stays silent when nothing is missing. It exits 0 on every path, so it never blocks a tool call.

Enable it at install time, or later:

```bash
claude plugin install codewatch@codewatch-local --config grepAugment=true
claude plugin configure codewatch@codewatch-local
```

The plugin option is exported to the hook as `CLAUDE_PLUGIN_OPTION_GREPAUGMENT`. When that is
unset the hook falls back to `CODEWATCH_GREP_AUGMENT`. Either one set to `1` or `true` enables
it; the plugin option wins when both are set.

## Finding the CLI: `CODEWATCH_BIN`

The launcher and both hooks use `$CODEWATCH_BIN` when set, else `codewatch` on `PATH`. The
Grep augment loads the read API from beside the CLI's entry file (`read-api/reader.js`), so
it follows symlinks but cannot see through a shell shim. If `codewatch` on `PATH` is a shim
(pnpm global, volta), the hook cannot find the read API and logs
`no read API beside ...` to stderr. Set `CODEWATCH_BIN` to the CLI's real entry, for example
`/path/to/node_modules/@codewatch/cli/dist/index.js`. A `.js` or `.mjs` value runs under node.

## Uninstall

```bash
claude plugin uninstall codewatch@codewatch-local
claude plugin marketplace remove codewatch-local
```

The `.codewatch/` directory in each indexed repo is yours to keep or delete.

## What it is worth

The one behavioral eval behind this plugin (C-88) measured something narrower than the
plugin: injecting the top-5 `graph similar` (`find_similar`) candidates into the agent's
prompt at plan time. It did not measure the SessionStart snapshot or the Grep augment, so
this README makes no cost or turn claim for either.

For the `find_similar` injection, on a tRPC clone, the injected arm used 28% less cost and
17% fewer turns than the control, and cut search turns on clean reuse cases (for example
24 to 8). Reuse of existing code went from 9 to 10 of 12 tasks, which is within noise. So
the value shown is cost, turns and reliability, not duplication prevention.

Caveats: n=12 tasks, a single run, one model (sonnet), one corpus, and only well-named,
documented exported utilities, the surface where grep is already strong. Treat the figures
as directional. Undocumented or poorly named code was not tested.

## Why there is no skill

A skill adds always-in-context description tokens. The experiments measured a skill at zero
codewatch calls (one tool search, then grep), so it would cost tokens with no measured
return. A skill should come back only if an eval shows it raising the call rate.
