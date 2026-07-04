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

## Requirements

- Node.js >= 20

## License

MIT
