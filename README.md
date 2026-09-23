# codewatch

Analyze code structure, drift, and architecture from your terminal.

codewatch indexes a TypeScript codebase into a dependency graph and reports on
it — architectural fitness checks, coupling and churn hotspots, layering
violations, ownership, and an interactive dashboard.

## Install

```sh
# one-off, no install
npx @codewatch/cli graph index .

# or install the `codewatch` command globally
npm i -g @codewatch/cli
```

The command is `codewatch` however you install it.

```sh
codewatch graph index .      # build the graph
codewatch graph check        # architectural fitness checks
codewatch graph dashboard    # interactive HTML dashboard
codewatch --help
```

Requires Node.js >= 20.

## Packages

This is a pnpm monorepo. The CLI is the published entry point; it depends on a
set of `@codewatch/*` library packages, all versioned and released together.

| Package | Role |
| --- | --- |
| [`@codewatch/cli`](packages/cli) | The `codewatch` command (published binary) |
| `@codewatch/render` | Graph rendering + dashboard generation |
| `@codewatch/core` | GitHub ingest, LLM providers, file cache |

The graph store, indexer, metrics, fitness checks, snapshot diffs and similar-symbol search
come from [`@titan-design/code-graph`](https://www.npmjs.com/package/@titan-design/code-graph).
It indexes TypeScript and Python. Embeddings for `graph embed` and `graph similar` come from
[`@titan-design/embed`](https://www.npmjs.com/package/@titan-design/embed).
Source files are parsed (tree-sitter, TypeScript, TSX and Python) and filtered by
[`@titan-design/code-parser`](https://www.npmjs.com/package/@titan-design/code-parser).
The style extractors and aggregator behind `codewatch analyze`, `init` and `update` come from
[`@titan-design/style-analyzer`](https://www.npmjs.com/package/@titan-design/style-analyzer).
The style-profile schema and exporters come from
[`@titan-design/style-profile`](https://www.npmjs.com/package/@titan-design/style-profile).
The style checks behind `codewatch check` and `codewatch diff` (ruff and ESLint runners,
config generators, profile diffing) come from
[`@titan-design/style-checker`](https://www.npmjs.com/package/@titan-design/style-checker).
Git history mining (churn, ownership, first-seen dates and change coupling) comes from the
`./history` entry of
[`@titan-design/code-graph`](https://www.npmjs.com/package/@titan-design/code-graph).

## Develop

```sh
pnpm install
pnpm build
pnpm test
pnpm -r typecheck
```

## Release

Releases use [changesets](https://github.com/changesets/changesets). The
`@codewatch/*` packages are a **fixed** group — they always version and publish
together.

1. `pnpm changeset` — describe the change and pick the bump.
2. `pnpm version-packages` — apply pending changesets (bumps versions, writes
   changelogs). Commit the result.
3. `pnpm release` — builds every package, then `changeset publish` pushes the
   ones whose version isn't yet on the registry.

`pnpm release` requires npm auth (`npm login`, or `NODE_AUTH_TOKEN` in CI) with
publish rights to the `@codewatch` scope. To preview the exact tarballs without
publishing:

```sh
pnpm -r run build
pnpm -r publish --dry-run --no-git-checks
```

A manual **Release** GitHub Actions workflow (`workflow_dispatch`) runs the same
steps; it defaults to a dry run and never fires automatically.

## License

MIT
