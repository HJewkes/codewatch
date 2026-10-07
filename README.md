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

## Reading the metrics

The metrics direct attention; they do not predict defects.

- **Hotspots** (churn × complexity) are Adam Tornhill's hotspot analysis from *Your Code as a
  Crime Scene*, also used by CodeScene. codewatch reimplements that technique; it did not invent it.
- **Cyclomatic and cognitive complexity** estimate comprehension friction: how slow a function
  is to read. Once file size is controlled for, they add little, so codewatch shows LOC beside
  them.
- **LCOM4** is a qualitative flag that a file may mix unrelated responsibilities. It is not a
  graded score or a verdict to split the file.

## Diffing snapshots

`codewatch graph diff --from <spec> --to <spec>` compares two graph snapshots: added, removed
and renamed nodes and edges, plus metric deltas. A spec is a snapshot id, a ref name, or, for
`--from` only, `previous` (the snapshot just before `--to`). An all-digit spec is tried as a
snapshot id first, then as a ref. Index a git commit without a checkout with
`graph index --rev <rev>`.

### `--footprint`: which doc units need regenerating

`--footprint` diffs symbol footprints instead and gates generated-doc units, so a doc
generator only runs a model for units whose symbols changed.

```sh
codewatch graph index . --rev HEAD~5 --ref base
codewatch graph index . --rev HEAD --ref head
codewatch graph diff --footprint --from base --to head
```

The output has:

- **Changed symbols**, each with a status and the reasons it changed.
- **The gate**: each unit is `regenerate` (new, or changed since its prior provenance), `skip`
  (unchanged), or `orphaned` (in the prior provenance but gone now).
- **`llmCallNeeded`**: `false` when no unit needs regenerating. A re-index with no source
  change yields 0 units to regenerate, so the doc generator makes no LLM call.
- **Provenance**: a fresh record per unit at the `--to` snapshot, with `model` null until a
  generator fills it in.

| Flag | Meaning |
| --- | --- |
| `--units <file>` | JSON array of `{unitId, symbolIds}`. Default: one unit per file. |
| `--provenance <file>` | Prior provenance to gate against: a JSON array of records, or an earlier run's `--json` output. Default: provenance computed at the `--from` snapshot. |
| `--json` | Structured output, including the provenance records to save for the next run. |

`--units` and `--provenance` are errors without `--footprint`.

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

## Claude Code plugin

`plugins/codewatch` is a Claude Code plugin that injects a budgeted repo snapshot at session
start, bundles the codewatch MCP server, and offers an opt-in Grep augment. It needs the
`codewatch` CLI on `PATH` and a one-time `codewatch graph index .` per repo.

```bash
claude plugin marketplace add /path/to/this/checkout
claude plugin install codewatch@codewatch-local
```

The only measured figures (-28% cost, -17% turns) are for injecting `find_similar`
candidates at plan time, not for the snapshot or the Grep augment. They come from n=12 tasks,
a single run, one model and documented-surface tasks only, and the reuse delta (9 to 10 of
12) is within noise. The plugin is a cost and turns optimization, not a duplication-prevention
claim. See
[plugins/codewatch/README.md](plugins/codewatch/README.md) for prerequisites, the Grep augment
opt-in, `CODEWATCH_BIN`, uninstall, the eval caveats, and why the plugin ships no skill.

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
