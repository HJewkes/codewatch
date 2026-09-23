# Research Brief: workflow:planning:research:c6750314

Plan: insight-layer-pr1-profile-risk | Project: CW

---

## Existing Code

### New files go in `packages/graph/src/` (NOT `packages/profile`)

`packages/profile` is an unrelated existing package for code-style exports (ESLint,
EditorConfig, etc.). The new `profile.ts` and `risk.ts` belong in
`packages/graph/src/` and export from `packages/graph/src/index.ts`.

### Key substrate modules in `packages/graph/src/`

| File | What it provides |
|---|---|
| `database.ts` | `GraphDatabase`: `listNodes`, `listEdges`, `listMetrics`, `getNode`. Synchronous better-sqlite3 queries. |
| `types.ts` | `GraphNode`, `GraphEdge`, `GraphMetric`, `NodeRole`, `EdgeKind` — canonical shared types. |
| `metrics.ts` | `computeMetrics(nodes, edges)` → `fan_in`, `fan_out`, `instability` stored in DB. |
| `source-metrics.ts` | `computeSourceMetrics()` → `loc`, `function_count`, `cognitive_max`, `cognitive_sum`, `cyclomatic_max`, `cyclomatic_sum`, `max_nesting_depth`. |
| `lcom.ts` | `computeLcomMetrics()` → `lcom4_max`, `class_count` (only for files with classes). |
| `churn.ts` | `loadChurnEntries()`, `aggregateChurn()` → `churn_30d`, `churn_30d_commits`, `churn_30d_authors`. Requires `repoRoot` + git. |
| `ownership.ts` | `computeOwnershipMetrics()` → `bus_factor_30d`, `top_author_share_30d`. |
| `change-coupling.ts` | `computeChangeCoupling(entries)` → `CoEditPair[]` sorted by count. Requires churn entries (loaded via `loadChurnEntries`). |
| `pagerank.ts` | `computePageRank(nodes, edges)` → `PageRankRow[]` sorted desc by score. Not stored in DB — computed on demand. |
| `roles.ts` | `classifyRole(id): NodeRole` (test/fixture/barrel/types/config/source). |

### Metric naming conventions (what's actually in the DB)

- Churn: `churn_${windowDays}d`, `churn_${windowDays}d_commits`, `churn_${windowDays}d_authors`
- Ownership: `bus_factor_${windowDays}d`, `top_author_share_${windowDays}d`
- Complexity: `cognitive_max`, `cognitive_sum`, `cyclomatic_max`, `cyclomatic_sum`, `max_nesting_depth`
- Graph: `fan_in`, `fan_out`, `instability`
- LCOM: `lcom4_max`, `class_count`
- Size: `loc`, `function_count`

### Context pattern (established in `graph-report-sections.ts`)

The project pre-loads all snapshot data once into an in-memory context, then runs per-node logic against it:

```ts
interface ReportContext {
  nodes: readonly GraphNode[];
  nodeById: Map<string, GraphNode>;
  metricsByName: Map<string, Map<string, number>>; // name → nodeId → value
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}
```

`AssembleCtx` for `assembleFileProfile` should follow this pattern. The CLI opens the DB, calls `db.listNodes/listEdges/listMetrics` once, builds the context, then calls `assembleFileProfile` per file.

### CLI command registration pattern

All `graph` subcommands registered in `packages/cli/src/commands/graph-cli.ts` via `registerGraph*` functions. Pattern:
- `registerGraphXxx(graphCmd: Command)` defines commander options
- Lazy import (`await import('./graph-xxx.js')`) inside the action handler
- `runGraphXxxCommand(options)` returns a typed result object
- `formatGraphXxxText(result)` and `formatGraphXxxJson(result)` handle output
- Each command lives in its own file: `graph-report.ts`, `graph-relevant.ts`, `graph-coupled.ts`, etc.

Existing commands: `index`, `diff`, `check`, `check-diff`, `top`, `relevant`, `coupled`, `report`, `render-diff`, `render`, `render-check-diff`, `prune`.

### Test infrastructure

**Graph package unit tests** (`packages/graph/src/__tests__/`): Pure vitest, no DB. Call compute functions directly with synthetic data:
```ts
import { describe, it, expect } from "vitest";
import { computeFoo } from "../foo.js";
```

**CLI integration tests** (`packages/cli/src/__tests__/`): Real SQLite via `openDatabase`. Standard fixture helper:
```ts
async function fixture(populate: (db, snapshotId) => void): Promise<{dir, dbPath}> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-xxx-"));
  const db = openDatabase(path.join(dir, "graph.db"));
  const snapshotId = db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
  populate(db, snapshotId);
  db.close();
  return { dir, dbPath: path.join(dir, "graph.db") };
}
afterEach(async () => { await fs.rm(fx.dir, { recursive: true, force: true }); });
```

Vitest config: `globals: true` in `vitest.config.ts`.

### `graph wiki` status

**No `graph wiki` command exists in the codebase.** The task says to retrofit both `graph report` and `graph wiki`, but there is no such command. See Knowledge Gaps #1.

### `graph report` hotspot section (retrofit target)

`graph-report-sections.ts:topHotspots` computes `churn × cognitive_max` with no risk banding. The retrofit would add `riskScore: RiskScore` to each `HotspotRow` or the report result — enabling band-aware display in subsequent artifacts.

## External Findings

- **Weighted composite scores (0-100)**: Standard pattern in SonarQube and CodeClimate. Clamp-at-max with per-factor ceilings is the industry norm. The design's `Math.min(100, sumOfFactors)` is correct.
- **Hotspot = churn × complexity**: Adam Thornhill's established technique (Code Maat, "Software Design X-Rays"). Treating this as the dominant signal at 40/100 is appropriate.
- **Percentile normalization**: Computing rank within package peers makes absolute metrics comparable across different-size codebases. The 90th-percentile anchor for hotspot normalization is a reasonable choice — aggressive but avoids over-flagging mid-range files.
- **Fan-in as blast radius**: Robert Martin's stability metrics. High fan-in means many callers break when this file changes. The 15-point cap is proportionate.
- **LCOM4 > 3 as "alert" threshold**: Used by SonarJava defaults. The design's cohesion factor triggering on `lcom4_max > 3` is defensible.
- **`band` naming**: The design's `"healthy" | "watch" | "elevated" | "urgent"` is distinct from the existing `Severity = "error" | "warning"` in `types.ts`. No collision.

## Knowledge Gaps

1. **`graph wiki` scope**: The task says to retrofit both `graph report` and `graph wiki` to use `RiskScore`, but `graph wiki` does not exist. Is the wiki retrofit out of scope for this PR, is a new `graph wiki` command being created here, or was "wiki" a typo for something else?

2. **`AssembleCtx` coupling data**: The `FileProfile.linkage.coupling` field (co-edited peers) requires `loadChurnEntries` which needs `repoRoot` (git access). The `assembleFileProfile(snapshotId, fileId, ctx)` signature has no `repoRoot`. Should `AssembleCtx` contain pre-computed `CoEditPair[]` (built by CLI before calling `assembleFileProfile`), or a `repoRoot` string, or should coupling be optional/absent when git isn't available?

3. **Hotspot normalization and `computeRiskScore` API**: The hotspot factor is "normalized to package 90th-pct" but `computeRiskScore(profile: FileProfile)` only receives one profile with no access to other files' scores. Options: (a) pre-normalize the hotspot contribution inside `assembleFileProfile` by embedding a `hotspotNormalized: number` field in the profile, or (b) add a `NormalizationCtx` second argument to `computeRiskScore`. Which is preferred?

4. **PageRank percentile**: `FileProfile.linkage.pageRankPercentile` requires knowing all nodes' raw PageRank scores to derive a percentile. PageRank is not stored in the DB. Should `AssembleCtx` include pre-computed PageRank results (requires full `computePageRank` at context-build time, ~O(n) with edges), or should a PageRank metric be persisted in the DB during indexing?

5. **Deterministic summary stub for PR #1**: `FileProfile.summary: string` is part of PR #1, but PR #5 ("Deterministic 1-line summaries") is where the real implementation ships. What is the acceptable PR #1 stub — `"${role}: ${name}"`, just the node name, or something else?

6. **Retrofit depth for `graph report`**: Should the retrofit add `riskScore: RiskScore` to each `HotspotRow`, or is it lighter (e.g., adding a `band` string column to the existing table)? The design says "no behavior change" — does that mean the text format is unchanged and only the JSON output gains the field?

## Recommendations

### 1. `AssembleCtx` design — pre-load everything

Model after `ReportContext`. Suggested shape:
```ts
interface AssembleCtx {
  nodes: readonly GraphNode[];
  nodeById: Map<string, GraphNode>;
  edgesBySrc: Map<string, GraphEdge[]>;  // for outboundEdges
  edgesByDst: Map<string, GraphEdge[]>;  // for inboundEdges
  metricsByName: Map<string, Map<string, number>>;
  pageRankByNodeId: Map<string, number>;     // pre-computed via computePageRank
  allFilePageRanks: readonly number[];       // for percentile computation
  couplingPairsByFile: Map<string, CoEditPair[]>;  // pre-computed, keyed by file
  windowDays: number;
}
```
Keeps `assembleFileProfile` pure (no I/O), making it trivially testable with synthetic maps.

### 2. Pre-normalize hotspot in `AssembleCtx`, keep `computeRiskScore(profile)` pure

Add `hotspotP90ByPackage: Map<string | null, number>` to `AssembleCtx`. `assembleFileProfile` embeds the raw hotspot score; `computeRiskScore` receives the p90 via an optional second arg or as part of the profile struct. Keeping `computeRiskScore(profile)` as the public API is cleanest for downstream callers who may not have package-level distributions.

### 3. Follow existing split-file pattern for `graph profile` CLI

Create `packages/cli/src/commands/graph-profile.ts` with `runGraphProfileCommand` + `formatGraphProfileText` + `formatGraphProfileJson`. Register via `registerGraphProfile(graphCmd)` in `graph-cli.ts`. This matches `graph-relevant.ts`, `graph-coupled.ts`, etc.

### 4. Add `profile.ts` and `risk.ts` to `index.ts` exports

Export `FileProfile`, `AssembleCtx`, `assembleFileProfile` from `profile.ts` and `RiskScore`, `RiskFactor`, `computeRiskScore` from `risk.ts`. Re-export both from `packages/graph/src/index.ts`.

### 5. Stub summary for PR #1

Use `"${node.role ?? 'file'}: ${node.name}"` as the deterministic stub. Document that PR #5 replaces it.

## Suggested Interview Questions

1. **`graph wiki` scope**: No `graph wiki` command exists. Is the wiki retrofit out of scope for this PR (only `graph report` needs updating), or is a new `graph wiki` command also being created here?

2. **Hotspot normalization**: The design says hotspot is "normalized to package 90th-pct" but `computeRiskScore(profile)` only sees one profile. Should normalization happen inside `assembleFileProfile` (embedding pre-normalized values in the profile struct), or should `computeRiskScore` accept a second normalization context argument?

3. **Coupling in `AssembleCtx`**: Assembling the coupling field requires git history. Should `AssembleCtx` contain pre-computed `CoEditPair[]` (built by the CLI before calling `assembleFileProfile`), or should coupling be optional/null when git isn't available?

4. **Deterministic summary stub**: `FileProfile.summary` is part of this PR, but the full summary implementation is PR #5. What should the PR #1 stub return — a simple `"${role}: ${name}"` string?

5. **`graph report` retrofit depth**: The design says "no behavior change." Does this mean the text output format stays identical and only the JSON output gains `riskScore` fields, or should the text table also gain a `Band` column?
