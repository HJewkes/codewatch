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

This is a pnpm monorepo with one published package, `@codewatch/cli`. The two other
workspace packages are private: the CLI build bundles their code, so installing the CLI is
all a user needs.

| Package | Role |
| --- | --- |
| [`@codewatch/cli`](packages/cli) | The `codewatch` command (the only published package) |
| `@codewatch/render` (private) | Graph rendering + dashboard generation |
| `@codewatch/core` (private) | GitHub ingest, LLM providers, file cache |

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

Releases use [changesets](https://github.com/changesets/changesets) and publish only
`@codewatch/cli`, through the manual **Release** GitHub Actions workflow with npm trusted
publishing (no tokens). It defaults to a dry run and never fires automatically.

1. `pnpm changeset` — describe the change and pick the bump.
2. `pnpm version-packages` — apply pending changesets (bumps versions, writes
   changelogs). Commit the result.
3. Run the **Release** workflow; see [docs/releasing.md](docs/releasing.md) for the
   steps, a local tarball check, and the retired package names.

## License

MIT
