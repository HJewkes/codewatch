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
| `@codewatch/graph` | Dependency-graph indexer + architectural metrics |
| `@codewatch/analyzer` | Code-corpus analysis + observation extractors |
| `@codewatch/render` | Graph rendering + dashboard generation |
| `@codewatch/checker` | Style / architecture checks |
| `@codewatch/profile` | Coding-style profile schema + exporters |
| `@codewatch/core` | Language parsing + shared primitives |

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
