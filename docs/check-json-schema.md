# `check.json` schema & `--json` output reference

`codewatch graph check` reads architectural fitness rules from a JSON file
(default `./.codewatch/check.json`). This is the single reference for that file's
schema and for the `--json` output contract of the `graph` subcommands.

Scaffold a starter file with `codewatch graph init` (writes the metric-ceiling
rules below). Run checks with:

```sh
codewatch graph check --snapshot head --baseline main
```

`--baseline` suppresses violations that already exist in the baseline snapshot, so
CI fails only on *new* or *worsened* violations (ratcheting).

## File shape

```jsonc
{
  "rules": [ /* one or more rule objects, see below */ ]
}
```

Any object may carry a `$comment` string (ignored by the checker) to document
intent. Unknown fields are ignored with a warning.

## Rule types

Every rule has an `id` (unique, human-readable) and a `type`. `severity` is
`"error"` (default — fails the check, non-zero exit) or `"warning"` (reported,
does not fail). Node-scoped rules accept `kind` (`file` | `symbol` | `package` |
`module`, default `file`), `exclude` (array of path substrings to skip), and
`excludeRoles` (array of node roles to skip, e.g. `["test", "fixture", "barrel",
"entry"]`).

### `metric-max` — ceiling on a metric

| field | type | notes |
|-------|------|-------|
| `metric` | string | metric name, e.g. `loc`, `cyclomatic_max`, `cognitive_max`, `max_nesting_depth`, `fan_out`, `fan_in`, `churn_30d` |
| `max` | number | violation when the node's metric **exceeds** this |
| `kind`, `severity`, `exclude`, `excludeRoles` | | as above |

```json
{ "id": "max-file-loc", "type": "metric-max", "metric": "loc", "kind": "file", "max": 350, "excludeRoles": ["test", "fixture"] }
```

### `metric-min` — floor on a metric

Same fields as `metric-max` but with `min` (violation when the metric is **below**
`min`). Useful for e.g. a minimum `coverage_pct`.

### `metric-product-max` — ceiling on a product of metrics

| field | type | notes |
|-------|------|-------|
| `metrics` | string[] | metric names; their values are multiplied |
| `max` | number | violation when the product exceeds this |

The canonical use is `scary-hotspots` (`churn_30d × cognitive_max × recency_30d`):
high-churn × high-cognitive-load files. Churn-based, so run with `--baseline`.

```json
{ "id": "scary-hotspots", "type": "metric-product-max", "metrics": ["churn_30d", "cognitive_max", "recency_30d"], "kind": "file", "max": 3000, "excludeRoles": ["test", "fixture"] }
```

### `layered-deps` — enforce an architecture layering

| field | type | notes |
|-------|------|-------|
| `layers` | string[][] | ordered layers; each layer is an array of path prefixes. A module may only depend on its own layer or lower layers |

Layer strings are path prefixes (longest-prefix-match wins). A new package placed
in the wrong layer fails automatically — no per-edge rule needed.

```json
{ "id": "package-layers", "type": "layered-deps", "layers": [ ["packages/core"], ["packages/analyzer", "packages/graph"], ["packages/cli"] ] }
```

### `forbid-import` — ban a specific dependency edge

| field | type | notes |
|-------|------|-------|
| `from` | string | path prefix of the importer |
| `to` | string | path prefix of the forbidden target |

```json
{ "id": "no-cli-from-core", "type": "forbid-import", "from": "packages/core", "to": "packages/cli" }
```

### `no-internal-only-barrels` — flag internal-only re-export barrels

| field | type | notes |
|-------|------|-------|
| `packageRoots` | string[] | path prefixes marking package roots; a barrel and its importer are same-package iff they share the same longest-matching prefix |
| `exclude` | string[] | substrings/globs to skip (e.g. CLI bin entries the role classifier mislabels) |

Flags `role=barrel` files with zero importers from *outside* their package —
indirection without abstraction value. Public-API barrels (imported across package
boundaries) are kept.

## `--json` output contract

Every data-producing `graph` subcommand accepts `--json` and prints a single JSON
document to **stdout**. Human/text output and any warnings go to **stderr**, so
`--json` stdout is always clean and pipeable.

| subcommand | top-level `--json` keys |
|------------|-------------------------|
| `graph init` | `configPath`, `config` (`"written"`/`"skipped"`), `hookInstalled`, `seededSnapshotId` |
| `graph index` | `dbPath`, `snapshotId`, `files`, `nodes`, `edges`, `metrics`, `durationMs`, … |
| `graph check` | `snapshot`, `baselineSnapshot`, `configPath`, `result` (`{ passed, violations[], … }`) |
| `graph coverage` | `snapshotId`, `files`, `symbols` |
| `graph diff` / `graph check-diff` | snapshot pair + `metricDeltas`/violation deltas |
| `graph top` | ranked node list |
| `graph relevant` | scored file list |
| `graph coupled` | co-change pairs |
| `graph report` | the full report data model |
| `graph arch` | partition/health/split evidence |
| `graph prune` | removed snapshot ids |
| `graph wiki` | package/section documents |

Render/dashboard subcommands (`graph dashboard`, `graph render*`) emit HTML/image
artifacts rather than a JSON data model and do not take `--json`.
