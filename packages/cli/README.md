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

## Requirements

- Node.js >= 20

## License

MIT
