import * as fs from "node:fs";
import {
  buildReportContext,
  qualitySection,
  type QualitySection,
} from "@titan-design/code-graph";
import { openGraphStore } from "../utils/graph-store.js";
import { runGraphCheckCommand } from "./graph-check.js";
import type { GraphReportResult } from "./graph-report.js";
import { detectPackages } from "./graph-wiki-packages.js";
import { classifyCoupling, importLinkage, type ImportLinkage } from "./import-linkage.js";
import type { ScoreInputs } from "./score-formula.js";

/** The hotspot score a file counts as scary at, as on the dashboard. */
const SCARY_CUTOFF = 3000;
/** Indexes without this per-function metric predate the SCBench measures. */
const QUALITY_METRIC = "symbol_body_lines";

export const NO_QUALITY_MESSAGE =
  "This snapshot has no quality section; re-index with code-graph ≥ 0.18 to score erosion.";

export interface SnapshotQuality {
  /** Absent when the snapshot was indexed before the SCBench measures existed. */
  quality?: QualitySection;
  linkage: ImportLinkage;
}

/**
 * The report's `quality` section and import linkage for the report's snapshot. codewatch's
 * `graph report` does not fill `quality`, so the score computes it from the same store.
 */
export function loadSnapshotQuality(
  dbPath: string,
  repoRoot: string,
  report: GraphReportResult,
): SnapshotQuality {
  const db = openGraphStore(dbPath);
  try {
    const id = report.snapshot.id;
    const edges = db.listEdges(id, { includeReferences: true });
    const linkage = importLinkage(edges);
    const metrics = db.listMetrics(id);
    if (!metrics.some((m) => m.name === QUALITY_METRIC)) return { linkage };
    const nodes = db.listNodes(id, { includeSymbols: true });
    const ctx = buildReportContext({
      nodes,
      metrics,
      excluders: [],
      excludedRoles: new Set(["script"]),
      windowDays: report.windowDays,
    });
    return { quality: qualitySection(nodes, ctx, detectPackages(repoRoot), edges), linkage };
  } finally {
    db.close();
  }
}

/**
 * Every violation of the snapshot, scored against no baseline so the count does not depend on
 * the run before. A tree with no rules file has none.
 */
export async function countViolations(dbPath: string, config: string, snapshotId: number): Promise<number> {
  if (!fs.existsSync(config)) return 0;
  const check = await runGraphCheckCommand({ db: dbPath, config, snapshot: snapshotId });
  return check.result.violations.filter((v) => v.ruleId !== "scary-hotspots").length;
}

/** Package complexity mass weights each package's share of value-cycle import weight. */
function massWeightedCyclicValue(quality: QualitySection): number {
  const mass = new Map(quality.complexity.packages.map((p) => [p.packageId, p.mass]));
  let weighted = 0;
  let total = 0;
  for (const row of quality.dependencies) {
    const m = mass.get(row.packageId) ?? 0;
    weighted += m * row.imports.value;
    total += m;
  }
  return total === 0 ? 0 : weighted / total;
}

export function scoreInputsFromReport(
  report: GraphReportResult,
  quality: QualitySection,
  linkage: ImportLinkage,
  violations: number,
): ScoreInputs {
  return {
    scary: report.hotspots.filter((h) => h.score >= SCARY_CUTOFF).length,
    violations,
    maxComplexity: report.hotspots.reduce((m, h) => Math.max(m, h.complexity), 0),
    hiddenCoupling: report.couplingClusters.filter(
      (c) => classifyCoupling(c.fileA, c.fileB, linkage).hidden,
    ).length,
    erosion: quality.complexity.total.erosion,
    cyclicMassValue: massWeightedCyclicValue(quality),
  };
}
