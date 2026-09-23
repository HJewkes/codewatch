# Design: Profile + RiskScore shared service (insight-layer PR #1)

## Approach

Two new pure modules in `packages/graph/src/`: `profile.ts` assembles every
per-file fact the substrate already stores into one `FileProfile` struct;
`risk.ts` composes that struct into an explained `RiskScore`. Both are pure
functions with no I/O. All snapshot data is pre-loaded once into an
`AssembleCtx` (mirroring the existing `ReportContext` pattern in
`graph-report-sections.ts`) by a `buildAssembleCtx(input)` helper, so a single
DB pass feeds many `assembleFileProfile` calls and unit tests can inject
synthetic maps.

The one subtlety is package-relative normalization. The hotspot factor is
"churn x cognitive_max normalized to the package 90th percentile" and PageRank
percentile needs the whole-snapshot PageRank distribution - neither is knowable
from a single file. We resolve this by computing all cross-file distributions at
`buildAssembleCtx` time (PageRank via `computePageRank`, per-package hotspot p90,
coupling pairs via `computeChangeCoupling`) and baking the resulting *derived*
values (`linkage.pageRankPercentile`, `activity.hotspotScore` +
`activity.hotspotNorm`) into each `FileProfile`. `computeRiskScore(profile)`
therefore stays a pure single-argument function - it reads the pre-normalized
fields off the profile and never needs a second normalization context. This is
consistent with the brief, which already treats `pageRankPercentile` as a
profile field even though it requires global context.

The CLI adds a thin `graph profile <id>` command following the established
split-file pattern (`run* / format*Text / format*Json / register*`). The
retrofit routes `graph report`'s hotspot rows and `graph wiki`'s per-file
banding through `computeRiskScore` so all surfaces band identically; markdown
text output for `graph report` is unchanged (risk data is additive to the result
struct and JSON only).

## Files to Create/Modify

| Action | Path | Purpose |
|--------|------|---------|
| Create | `packages/graph/src/profile.ts` | `FileProfile`, `AssembleCtx`, `buildAssembleCtx`, `assembleFileProfile` |
| Create | `packages/graph/src/risk.ts` | `RiskScore`, `RiskFactor`, `RiskBand`, `computeRiskScore` |
| Create | `packages/graph/src/__tests__/profile.test.ts` | Assembly tests from synthetic `AssembleCtx` |
| Create | `packages/graph/src/__tests__/risk.test.ts` | Recipe + banding + edge-case tests |
| Create | `packages/cli/src/commands/graph-profile.ts` | `runGraphProfileCommand`, `formatGraphProfileText`, `formatGraphProfileJson`, `registerGraphProfile` |
| Create | `packages/cli/src/__tests__/graph-profile.test.ts` | CLI integration test against real SQLite fixture |
| Modify | `packages/graph/src/index.ts` | Export profile + risk symbols/types |
| Modify | `packages/cli/src/commands/graph-cli.ts` | Import + call `registerGraphProfile(graphCmd)` |
| Modify | `packages/cli/src/commands/graph-report-types.ts` | Add `risk?: RiskScore` to `HotspotRow` |
| Modify | `packages/cli/src/commands/graph-report-sections.ts` | Attach `computeRiskScore` result to hotspot rows via a shared `AssembleCtx` |
| Modify | `packages/cli/src/commands/graph-report-format.ts` | Surface `risk.band`/`risk.score` in JSON; markdown unchanged |
| Modify | `packages/cli/src/commands/graph-wiki.ts` | Read `RiskScore` band for per-file/hotspot banding |

## API Shapes / Type Signatures

```ts
// packages/graph/src/profile.ts
import type {
  CoEditPair, EdgeKind, GraphEdge, GraphMetric, GraphNode, NodeRole,
} from "./types.js";
import type { ChurnWindow } from "./churn-window.js";

export interface FileProfile {
  id: string;
  package: { id: string; name: string } | null;
  role: NodeRole | null;
  size: { loc: number; functionCount: number; classCount: number };
  complexity: {
    cognitiveMax: number; cognitiveSum: number;
    cyclomaticMax: number; cyclomaticSum: number;
    maxNestingDepth: number; lcom4Max: number | null;
  };
  linkage: {
    fanIn: number; fanOut: number; instability: number;
    pageRankPercentile: number;              // 0..100, rank within all file nodes (share at-or-below x 100)
    inboundEdges: Array<{ src: string; kind: EdgeKind }>;
    outboundEdges: Array<{ dst: string; kind: EdgeKind; crossPackage: boolean }>;
    coupling: Array<{ peer: string; count: number }>;
  };
  ownership: {
    busFactor: number; topAuthor: string | null;
    topAuthorShare: number; distinctAuthors: number;
  };
  activity: {
    churnLines: number; churnCommits: number; windowDays: ChurnWindow;
    hotspotScore: number;   // raw churn x cognitiveMax
    hotspotNorm: number;    // 0..1, hotspotScore / package-90th-pct anchor (clamped 1)
  };
  summary: string;          // deterministic stub in PR #1; PR #5 replaces
}

export interface AssembleCtx {
  nodes: readonly GraphNode[];
  nodeById: Map<string, GraphNode>;
  edgesBySrc: Map<string, GraphEdge[]>;
  edgesByDst: Map<string, GraphEdge[]>;
  metricsByName: Map<string, Map<string, number>>;  // canonical name -> nodeId -> value
  pageRankByNodeId: Map<string, number>;
  filePageRanksSorted: readonly number[];           // ascending, file nodes only
  hotspotP90ByPackage: Map<string | null, number>;  // package id (or null) -> p90 anchor
  couplingByFile: Map<string, Array<{ peer: string; count: number }>>;
  windowDays: ChurnWindow;
}

export interface BuildAssembleCtxInput {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  metrics: readonly GraphMetric[];
  windowDays: ChurnWindow;
  coupling?: readonly CoEditPair[];  // pre-loaded by CLI from loadChurnEntries; [] when no git
}

export function buildAssembleCtx(input: BuildAssembleCtxInput): AssembleCtx;

export function assembleFileProfile(
  snapshotId: number, fileId: string, ctx: AssembleCtx,
): FileProfile;
```

```ts
// packages/graph/src/risk.ts
import type { FileProfile } from "./profile.js";

export type RiskFactorKey =
  | "hotspot" | "complexity_peak" | "high_fanout"
  | "high_fanin" | "cohesion" | "recency";

export type RiskBand = "healthy" | "watch" | "elevated" | "urgent";

export interface RiskFactor {
  key: RiskFactorKey;
  weight: number;                        // points contributed (pre-clamp)
  detail: string;                        // evidence, e.g. "LCOM4=9 (>3)"
  severity: "info" | "warn" | "alert";
}

export interface RiskScore {
  score: number;                         // 0..100, integer, clamped
  band: RiskBand;
  factors: RiskFactor[];                 // sorted desc by weight
}

export function computeRiskScore(profile: FileProfile): RiskScore;

// Pure banding helper, reused by report/wiki retrofit for consistent banding:
export function bandForScore(score: number): RiskBand;

// Exposed constants (rationale in comments) - opinionated v1, no config surface.
// Per-factor caps; keys map to RiskFactorKey. bus_factor intentionally absent.
export const RISK_WEIGHTS: {
  hotspot: 40; complexity_peak: 20; high_fanout: 15; high_fanin: 15; cohesion: 10;
};
```

`index.ts` re-exports: `FileProfile`, `AssembleCtx`, `BuildAssembleCtxInput`,
`buildAssembleCtx`, `assembleFileProfile` (from `profile.ts`) and `RiskScore`,
`RiskFactor`, `RiskFactorKey`, `RiskBand`, `computeRiskScore`, `bandForScore`,
`RISK_WEIGHTS` (from `risk.ts`).

```ts
// packages/cli/src/commands/graph-profile.ts
export interface GraphProfileCommandOptions {
  db: string; repoRoot: string; fileId: string;
  snapshot?: number; windowDays?: ChurnWindow; json?: boolean;
}
export interface GraphProfileResult {
  snapshot: SnapshotRow; profile: FileProfile; risk: RiskScore;
}
export function runGraphProfileCommand(o: GraphProfileCommandOptions): GraphProfileResult;
export function formatGraphProfileText(r: GraphProfileResult): string;
export function formatGraphProfileJson(r: GraphProfileResult): string;
export function registerGraphProfile(graphCmd: Command): void;
```

## Data Flow

```
CLI (graph-profile.ts / graph-report.ts / graph-wiki.ts)
  openDatabase -> pickSnapshot -> db.listNodes / listEdges / listMetrics
  loadChurnEntries(repoRoot) -> computeChangeCoupling  (coupling pairs; [] if no git)
        |
        v
  buildAssembleCtx({nodes, edges, metrics, windowDays, coupling})
     - metricsByName via canonicalMetricName
     - computePageRank(nodes, edges) -> pageRankByNodeId + filePageRanksSorted
     - per-package hotspot p90 (churn x cognitive_max over file nodes)
     - couplingByFile from coupling pairs
        |
        v
  assembleFileProfile(snapshotId, fileId, ctx)  [pure] -> FileProfile
        |
        v
  computeRiskScore(profile)  [pure] -> RiskScore
        |
        v
  format*Text / format*Json  (profile cmd)
  OR attach risk to HotspotRow (report/wiki retrofit)
```

## Key Decisions

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Normalization locus | Pre-compute into `FileProfile` at assembly | Second `NormalizationCtx` arg to `computeRiskScore` | Keeps `computeRiskScore(profile)` a pure single-arg public API; consistent with brief's `pageRankPercentile` already being a derived profile field |
| `AssembleCtx` I/O | Pure; caller pre-loads everything (incl. coupling pairs) | Pass `repoRoot` and load git inside assembly | Matches `ReportContext`; trivially unit-testable with synthetic maps; assembly stays deterministic |
| PageRank source | Computed at `buildAssembleCtx` time via `computePageRank` | Persist a PageRank metric in DB (new migration) | Avoids a migration in PR #1; report already computes PageRank on demand |
| Coupling when no git | `coupling` defaults to `[]`; `linkage.coupling` empty | Make coupling non-optional / throw | Git may be absent (shallow clone); profile must still assemble |
| Summary in PR #1 | Minimal deterministic stub `"<role>: <name>"` | Full filename+role+imports summary now | Full deterministic summary is explicitly PR #5; stub is documented as replaced |
| Report retrofit depth | Add `risk?: RiskScore` to result/JSON; markdown text unchanged | Add a `Band` column to the markdown table | R8 "no behavior change" - text stays identical; bands consumed by PR #2 artifacts |
| Hotspot factor input | Reuse existing `churn_<w>` x `cognitive_max` (same as `hotspotScoreOf`) | New composite metric | Single source of truth with existing report hotspot definition |

## Risks and Mitigations

- **Risk: report/wiki retrofit changes markdown output, breaking snapshot tests.**
  Mitigation: attach risk only to the result struct + JSON formatter; assert an
  existing `graph report` text golden is byte-identical (AC covers this).
- **Risk: hotspot p90 with tiny packages (1-2 files) produces degenerate anchors
  (0 or self).** Mitigation: when the package p90 anchor is 0, `hotspotNorm`
  falls back to 0 (no hotspot points) rather than dividing by zero; documented
  and tested (EC-02).
- **Risk: `computePageRank` cost at ctx-build time on large snapshots.**
  Mitigation: computed once per command invocation (report already does this);
  acceptable for the dogfood target. Flag if profiling shows a regression.
- **Risk: metric-name drift (`churn_30d` vs window suffix).** Mitigation: always
  resolve names through `windowSuffix(windowDays)` + `canonicalMetricName`.

## Scaffolding vs. Implementation

- **Scaffolding (wave 1, blocking):**
  - `packages/graph/src/profile.ts` types (`FileProfile`, `AssembleCtx`,
    `BuildAssembleCtxInput`) and function signatures (stub bodies).
  - `packages/graph/src/risk.ts` types (`RiskFactor`, `RiskScore`, `RiskBand`,
    `RISK_WEIGHTS`) and `computeRiskScore` signature.
  - `packages/graph/src/index.ts` exports.
  These define the contract every other file imports; must land first.
- **Implementation (wave 2+, parallelizable once wave 1 types exist):**
  - `buildAssembleCtx` + `assembleFileProfile` bodies (owner A, profile.ts).
  - `computeRiskScore` body + recipe constants (owner B, risk.ts).
  - `graph-profile.ts` CLI + registration + CLI integration test (owner C).
  - report/wiki retrofit across `graph-report-types.ts`,
    `graph-report-sections.ts`, `graph-report-format.ts`, `graph-wiki.ts`
    (owner D - single owner for these 4 files to avoid conflicts).
  - Unit tests `profile.test.ts` (owner A) and `risk.test.ts` (owner B).

## PR Boundaries

- Option A: One PR for everything (profile + risk + CLI + retrofit).
- Option B: Split assembly/risk from the retrofit into two PRs.
- **Recommendation: Option A (single PR).** This *is* PR #1 of a pre-agreed
  5-PR sequence and is internally cohesive at ~400 LoC. The retrofit is the
  proof that the shared service is actually load-bearing (single source of
  truth), so shipping it with the service - not after - is the point. Keep the
  internal wave ordering (scaffolding first) for reviewability, but land as one
  PR.
