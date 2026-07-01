import type { CodewatchData } from "./types";

/**
 * Bundled fallback, derived from a real codewatch self-index. Replaced at
 * report-generation time by `window.__CODEWATCH__`. Kept small but realistic.
 */
export const SAMPLE_DATA: CodewatchData = {
  meta: {
    repo: "codewatch",
    snapshotId: 110,
    ref: "wd",
    windowDays: 30,
    generatedAt: "2026-06-30T19:00:00Z",
    indexVersion: "0.2.0",
    fileCount: 288,
    authorCount: 1,
    baseline: { ref: "v-prev", snapshotId: 97 },
  },
  kpis: {
    health: 72,
    healthTrend: -4,
    scaryHotspots: 3,
    knowledgeSilos: 10,
    boundaryHealth: 0.71,
    openViolations: { total: 2, new: 0, carry: 2, fixed: 1 },
    maxComplexity: 22,
  },
  hotspots: [
    { nodeId: "packages/graph/src/indexer.ts", churn: 265, complexity: 19, score: 5035, role: "source" },
    { nodeId: "packages/graph/src/incremental.ts", churn: 199, complexity: 22, score: 4378, role: "source" },
    { nodeId: "packages/graph/src/test-linker.ts", churn: 113, complexity: 15, score: 1695, role: "source" },
    { nodeId: "packages/graph/src/check-validate.ts", churn: 92, complexity: 14, score: 1288, role: "source" },
    { nodeId: "packages/cli/src/commands/hook-cli.ts", churn: 105, complexity: 10, score: 1050, role: "source" },
    { nodeId: "packages/cli/src/commands/graph-auto-update.ts", churn: 89, complexity: 10, score: 890, role: "source" },
    { nodeId: "packages/cli/src/commands/hook.ts", churn: 76, complexity: 9, score: 684, role: "source" },
    { nodeId: "packages/graph/src/ownership.ts", churn: 63, complexity: 8, score: 504, role: "source" },
    { nodeId: "packages/graph/src/database.ts", churn: 134, complexity: 3, score: 402, role: "source" },
    { nodeId: "packages/graph/src/source-metrics.ts", churn: 19, complexity: 18, score: 342, role: "source" },
  ],
  busFactorRisks: [
    { nodeId: "packages/graph/src/indexer.ts", topAuthorShare: 1, churn: 265 },
    { nodeId: "packages/graph/src/incremental.ts", topAuthorShare: 1, churn: 199 },
    { nodeId: "packages/graph/src/database.ts", topAuthorShare: 1, churn: 134 },
    { nodeId: "packages/graph/src/test-linker.ts", topAuthorShare: 1, churn: 113 },
    { nodeId: "packages/cli/src/commands/hook-cli.ts", topAuthorShare: 1, churn: 105 },
  ],
  testCoverageRisks: [
    { nodeId: "packages/graph/src/indexer.ts", testBusFactor: 1, testTopAuthorShare: 1, linkedTests: 1 },
    { nodeId: "packages/graph/src/test-linker.ts", testBusFactor: 1, testTopAuthorShare: 1, linkedTests: 2 },
    { nodeId: "packages/graph/src/incremental.ts", testBusFactor: 1, testTopAuthorShare: 1, linkedTests: 3 },
  ],
  couplingClusters: [
    { a: "packages/graph/src/indexer.ts", b: "packages/graph/src/index-metrics.ts", coEdits: 8, hidden: false },
    { a: "packages/graph/src/diff.ts", b: "packages/graph/src/aliases.ts", coEdits: 5, hidden: true },
  ],
  centralFiles: [
    { nodeId: "packages/graph/src/types.ts", score: 0.0291 },
    { nodeId: "packages/graph/src/database.ts", score: 0.0264 },
    { nodeId: "packages/graph/src/db-rows.ts", score: 0.0219 },
    { nodeId: "packages/graph/src/roles.ts", score: 0.0158 },
    { nodeId: "packages/cli/src/commands/graph-cli.ts", score: 0.0142 },
  ],
  violations: [
    {
      rule: "scary-hotspots",
      severity: "error",
      file: "packages/graph/src/indexer.ts",
      detail: "churn_30d=265 × cognitive_max=19 = 5035 > 3000",
      status: "carry",
    },
    {
      rule: "scary-hotspots",
      severity: "error",
      file: "packages/graph/src/incremental.ts",
      detail: "churn_30d=199 × cognitive_max=22 = 4378 > 3000",
      status: "carry",
    },
  ],
  packages: [
    { pkgId: "packages/core", instability: 0.0, abstractness: 0.17, fileCount: 18, layer: "foundation", cohesion: 1.0 },
    { pkgId: "packages/graph", instability: 0.22, abstractness: 0.02, fileCount: 60, layer: "foundation", cohesion: 0.78 },
    { pkgId: "packages/analyzer", instability: 0.77, abstractness: 0.05, fileCount: 43, layer: "middle", cohesion: 0.44 },
    { pkgId: "packages/checker", instability: 0.8, abstractness: 0.12, fileCount: 17, layer: "middle", cohesion: 0.5 },
    { pkgId: "packages/render", instability: 0.7, abstractness: 0.04, fileCount: 25, layer: "middle", cohesion: 0.55 },
    { pkgId: "packages/profile", instability: 0.0, abstractness: 0.03, fileCount: 30, layer: "foundation", cohesion: 1.0 },
    { pkgId: "packages/cli", instability: 1.0, abstractness: 0.01, fileCount: 74, layer: "top", cohesion: 0.0 },
  ],
  drift: {
    baselineSnapshotId: 97,
    newHotspots: [
      { nodeId: "packages/graph/src/test-linker.ts", score: 1695 },
      { nodeId: "packages/cli/src/commands/hook-cli.ts", score: 1050 },
    ],
    worsened: [
      { nodeId: "packages/graph/src/indexer.ts", before: 4693, after: 5035, delta: 342 },
      { nodeId: "packages/graph/src/index-metrics.ts", before: 186, after: 303, delta: 117 },
    ],
    improved: [
      { nodeId: "packages/cli/src/index.ts", before: 402, after: 0, delta: -402 },
    ],
    resolved: [
      { nodeId: "packages/graph/src/diff.ts", before: 900, after: 120, delta: -780 },
    ],
    newSilos: ["packages/graph/src/db-rows.ts"],
    newCoupling: [
      { a: "packages/graph/src/diff.ts", b: "packages/graph/src/aliases.ts", coEdits: 5, hidden: true },
    ],
  },
};
