#!/usr/bin/env node
// Synthesize CodewatchData payloads for pathological repos, to screenshot the
// dashboard's degenerate-data resilience (edge cases the P0 catalog flagged:
// dormant, script-noise/outlier, huge, single-author, clean).
import { writeFileSync, mkdirSync } from "node:fs";

const dir = process.argv[2] ?? "data";
mkdirSync(dir, { recursive: true });

const meta = (o) => ({
  repo: "fixture", snapshotId: 1, ref: "wd", windowDays: 30,
  generatedAt: "2026-06-30T00:00:00Z", indexVersion: "0.2.0", ...o,
});
const kpis = (o) => ({
  health: 100, newHotspots: 0, knowledgeSilos: 0, boundaryHealth: undefined,
  openViolations: { total: 0, new: 0, carry: 0, fixed: 0 }, maxComplexity: 0, ...o,
});
const empty = { hotspots: [], busFactorRisks: [], couplingClusters: [], centralFiles: [], violations: [] };

// 1) Dormant: no churn in window → empty-window banner + empty widgets.
const dormant = {
  meta: meta({ repo: "fx-dormant", emptyWindow: true, fileCount: 84, authorCount: 1,
    hint: "No commits in the last 30d — churn-based sections are empty. Try a wider window: `--window-days 180`." }),
  kpis: kpis({ health: 100, boundaryHealth: 0.44 }),
  ...empty,
  centralFiles: [
    { nodeId: "src/core/engine.ts", score: 0.031 },
    { nodeId: "src/core/registry.ts", score: 0.022 },
  ],
};

// 2) Script-noise + outlier: one archived script dwarfs everything.
const outlier = {
  meta: meta({ repo: "fx-outlier", fileCount: 130, authorCount: 3, baseline: { ref: "main", snapshotId: 40 } }),
  kpis: kpis({ health: 41, newHotspots: 1, knowledgeSilos: 2, boundaryHealth: 0.28,
    openViolations: { total: 3, new: 1, carry: 2, fixed: 0 }, maxComplexity: 511 }),
  hotspots: [
    { nodeId: "archive/scripts/mega-migration.ts", churn: 402, complexity: 511, score: 205422 },
    { nodeId: "src/api/router.ts", churn: 40, complexity: 18, score: 720 },
    { nodeId: "src/api/handlers.ts", churn: 22, complexity: 14, score: 308 },
    { nodeId: "src/db/pool.ts", churn: 12, complexity: 9, score: 108 },
    { nodeId: "src/util/log.ts", churn: 8, complexity: 5, score: 40 },
  ],
  busFactorRisks: [
    { nodeId: "archive/scripts/mega-migration.ts", topAuthorShare: 1, churn: 402 },
    { nodeId: "src/api/router.ts", topAuthorShare: 0.82, churn: 40 },
  ],
  couplingClusters: [{ a: "src/api/router.ts", b: "src/api/handlers.ts", coEdits: 6, hidden: false }],
  centralFiles: [{ nodeId: "src/api/router.ts", score: 0.04 }],
  violations: [
    { rule: "scary-hotspots", severity: "error", file: "archive/scripts/mega-migration.ts", detail: "churn_30d=402 × cognitive_max=511 = 205422 > 3000", status: "new" },
    { rule: "max-cyclomatic-per-function", severity: "error", file: "archive/scripts/mega-migration.ts", detail: "cyclomatic_max=511 > 30", status: "carry" },
    { rule: "max-file-loc", severity: "error", file: "archive/scripts/mega-migration.ts", detail: "loc=8123 > 350", status: "carry" },
  ],
};

// 3) Huge: thousands of hotspots → treemap "+M more", table needs truncation.
const huge = {
  meta: meta({ repo: "fx-huge", fileCount: 11250, authorCount: 14, baseline: { ref: "release-2.0", snapshotId: 800 } }),
  kpis: kpis({ health: 63, newHotspots: 38, knowledgeSilos: 210, boundaryHealth: 0.51,
    openViolations: { total: 74, new: 9, carry: 65, fixed: 12 }, maxComplexity: 96 }),
  hotspots: Array.from({ length: 400 }, (_, i) => {
    const churn = Math.round(300 / (i + 1)) + 3;
    const complexity = Math.round(90 / (i + 1)) + 2;
    return { nodeId: `packages/p${i % 20}/src/mod${i}.ts`, churn, complexity, score: churn * complexity };
  }),
  busFactorRisks: Array.from({ length: 30 }, (_, i) => ({ nodeId: `packages/p${i % 20}/src/mod${i}.ts`, topAuthorShare: 0.7 + (i % 3) * 0.1, churn: 120 - i })),
  couplingClusters: [],
  centralFiles: Array.from({ length: 10 }, (_, i) => ({ nodeId: `packages/core/src/base${i}.ts`, score: 0.05 - i * 0.003 })),
  violations: Array.from({ length: 20 }, (_, i) => ({ rule: i % 2 ? "max-file-loc" : "scary-hotspots", severity: "error", file: `packages/p${i}/src/mod${i}.ts`, detail: `metric over threshold #${i}`, status: i < 9 ? "new" : "carry" })),
};

// 4) Clean: healthy repo, no violations → Fitness EmptyState.
const clean = {
  meta: meta({ repo: "fx-clean", fileCount: 60, authorCount: 4, baseline: { ref: "v1.0", snapshotId: 12 } }),
  kpis: kpis({ health: 96, newHotspots: 0, knowledgeSilos: 0, boundaryHealth: 0.83, openViolations: { total: 0, new: 0, carry: 0, fixed: 3 }, maxComplexity: 11 }),
  hotspots: [
    { nodeId: "src/app.ts", churn: 20, complexity: 8, score: 160 },
    { nodeId: "src/routes.ts", churn: 14, complexity: 6, score: 84 },
  ],
  busFactorRisks: [],
  couplingClusters: [],
  centralFiles: [{ nodeId: "src/app.ts", score: 0.04 }],
  violations: [],
};

for (const [name, d] of Object.entries({ dormant, outlier, huge, clean })) {
  writeFileSync(`${dir}/fx-${name}.json`, JSON.stringify(d, null, 2));
  console.log(`wrote ${dir}/fx-${name}.json`);
}
