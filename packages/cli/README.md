# @codewatch/cli

Analyze code structure, drift, and architecture from your terminal.

`codewatch` builds a dependency graph of a TypeScript codebase and reports on
it: architectural fitness checks, coupling and churn hotspots, layering, and an
interactive dashboard.

## Install

```sh
# one-off, no install
npx @codewatch/cli graph index .

# or install the `codewatch` command globally
npm i -g @codewatch/cli
codewatch --help
```

The published binary is named **`codewatch`** regardless of how you install it.

## Quick start

```sh
codewatch graph index .          # build the graph for the current repo
codewatch graph check            # run the architectural fitness checks
codewatch graph dashboard        # generate an interactive HTML dashboard
```

Run `codewatch --help` for the full command surface.

## Reading the metrics

The metrics direct attention; they do not predict defects. Hotspots (churn × complexity) are
Adam Tornhill's hotspot analysis from *Your Code as a Crime Scene*, also used by CodeScene.
Complexity estimates comprehension friction and is shown beside LOC, because once file size is
controlled for it adds little. LCOM4 is a qualitative flag that a file may mix concerns, not a
verdict to split it.

## Audit: entry points and input classes (Python)

`codewatch audit` checks test gaps at public entry points only. An entry is a console script, a
function a `__main__` guard or `__main__.py` calls, or an HTTP `do_GET`-style handler method. A
repo with none of those uses the public functions its tests call directly instead.
`missing-test-kind` fires only on entries, so private and internal helpers get no per-symbol
test-gap rows.

For each entry, `input-classes.json` (next to `findings.jsonl`) lists the input classes its tests
feed. These are empty input; present, null, missing or empty for each optional key a reader in
its call closure reads; each CLI flag on and off; error codes asserted under only one flag
setting; and error codes no test asserts. Each class no test feeds becomes one
`entry-input-class` finding, at most five per entry and ranked. These findings are questions for
the next change, not fix items, and triage does not ask about them.

The detection is static. It follows `dict(BASE, k=v)`, `{**BASE}`, and `del`/`pop`/assignment
edits to a bound copy inside a test. It does not see inputs built at runtime (loops, fixtures,
computed parametrize ids), reader keys held in variables (`record.get(field)`), or input classes
in a pattern language inside strings.

## Requirements

- Node.js >= 20

## License

MIT
