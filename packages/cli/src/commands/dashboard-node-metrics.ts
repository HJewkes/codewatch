import type { runGraphReportCommand } from "./graph-report.js";

/**
 * Per-file structural metrics for the dashboard Dossier heat readout. Extracted
 * from dashboard-payload so that file stays under the max-file-loc budget.
 */
export interface NodeMetrics {
  loc?: number;
  cognitiveMax?: number;
  cyclomaticMax?: number;
  maxNesting?: number;
  fanIn?: number;
  fanOut?: number;
  utilization?: number;
  /** Node role (e.g. "barrel") — lets the Dossier explain barrel-resolved utilization. */
  role?: string;
}

/** The numeric NodeMetrics fields fed from metric rows (excludes `role`). */
type NumericMetricField = Exclude<keyof NodeMetrics, "role">;

/** Metric name → NodeMetrics field, for the structural metrics the Dossier heats. */
const METRIC_FIELD: Record<string, NumericMetricField> = {
  loc: "loc",
  cognitive_max: "cognitiveMax",
  cyclomatic_max: "cyclomaticMax",
  max_nesting_depth: "maxNesting",
  fan_in: "fanIn",
  fan_out: "fanOut",
  utilization: "utilization",
};

/** Fold the flat metric rows into a per-node structural-metrics map. */
export function collectNodeMetrics(
  rows: { nodeId: string; name: string; value: number | null }[],
): Map<string, NodeMetrics> {
  const byNode = new Map<string, NodeMetrics>();
  for (const m of rows) {
    const field = METRIC_FIELD[m.name];
    if (!field || m.value === null) continue;
    const entry = byNode.get(m.nodeId) ?? {};
    entry[field] = m.value;
    byNode.set(m.nodeId, entry);
  }
  return byNode;
}

/** Every file the Dossier can open on (referenced in hotspots / silos / coupling / coverage / central / drift). */
export function referencedNodes(
  report: ReturnType<typeof runGraphReportCommand>,
): Set<string> {
  const referenced = new Set<string>();
  for (const h of report.hotspots) referenced.add(h.nodeId);
  for (const b of report.busFactorRisks) referenced.add(b.nodeId);
  for (const t of report.testCoverageRisks) referenced.add(t.nodeId);
  for (const c of report.couplingClusters) { referenced.add(c.fileA); referenced.add(c.fileB); }
  for (const c of report.centralFiles) referenced.add(c.nodeId);
  const drift = report.drift;
  if (drift) {
    for (const h of drift.newHotspots) referenced.add(h.nodeId);
    for (const d of drift.worsenedHotspots) referenced.add(d.nodeId);
    for (const c of drift.newCoupling) { referenced.add(c.fileA); referenced.add(c.fileB); }
  }
  return referenced;
}

/**
 * Structural metrics for every file the Dossier can open on. Scoped to
 * referenced nodes rather than the whole graph to keep the payload tight — the
 * Dossier never opens on an unreferenced file.
 */
export function buildNodeMetrics(
  report: ReturnType<typeof runGraphReportCommand>,
  metrics: ReadonlyMap<string, NodeMetrics>,
): Record<string, NodeMetrics> {
  const out: Record<string, NodeMetrics> = {};
  for (const id of referencedNodes(report)) {
    const m = metrics.get(id);
    if (m) out[id] = m;
  }
  return out;
}

/**
 * Reading-order centrality (top-N central files) PLUS the centrality of every
 * node referenced elsewhere in the payload (hotspots, silos, coupling), so the
 * Dossier can always show a PageRank score instead of "—" for a hotspot that
 * falls outside the top-N central list. Sorted descending, so the Overview
 * "reading order" (top-6 slice) is unaffected.
 */
export function buildCentralFiles(
  report: ReturnType<typeof runGraphReportCommand>,
  centrality: ReadonlyMap<string, number>,
): { nodeId: string; score: number }[] {
  const byId = new Map<string, number>();
  for (const c of report.centralFiles) byId.set(c.nodeId, c.score);
  const referenced = new Set<string>();
  for (const h of report.hotspots) referenced.add(h.nodeId);
  for (const b of report.busFactorRisks) referenced.add(b.nodeId);
  for (const c of report.couplingClusters) { referenced.add(c.fileA); referenced.add(c.fileB); }
  for (const id of referenced) if (!byId.has(id)) byId.set(id, centrality.get(id) ?? 0);
  return [...byId].map(([nodeId, score]) => ({ nodeId, score })).sort((a, b) => b.score - a.score);
}

/** One export's utilization (C-53), tagged with the file that declares it. */
export interface SymbolUtil {
  symbolId: string;
  name: string;
  fileId: string;
  utilization: number;
}

/** Pair each `symbol` node with its utilization metric and declaring file (C-53). */
export function collectSymbolUtil(
  nodes: readonly { id: string; kind: string; name: string; parentId?: string }[],
  metrics: ReadonlyMap<string, NodeMetrics>,
): SymbolUtil[] {
  const out: SymbolUtil[] = [];
  for (const n of nodes) {
    if (n.kind !== "symbol" || !n.parentId) continue;
    out.push({
      symbolId: n.id,
      name: n.name,
      fileId: n.parentId,
      utilization: metrics.get(n.id)?.utilization ?? 0,
    });
  }
  return out;
}

export interface HotExport {
  name: string;
  utilization: number;
}

/**
 * Per-file ranked "hot exports" (symbol utilization, C-53), so the Dossier can
 * show *which* of a file's exports carry its load. Scoped to files the Dossier
 * can open on; top 8 exports each, so a large public surface stays readable.
 */
export function buildHotExports(
  symbols: readonly SymbolUtil[],
  referenced: ReadonlySet<string>,
): Record<string, HotExport[]> {
  const byFile = new Map<string, HotExport[]>();
  for (const s of symbols) {
    if (s.utilization <= 0 || !referenced.has(s.fileId)) continue;
    const bucket = byFile.get(s.fileId) ?? [];
    bucket.push({ name: s.name, utilization: s.utilization });
    byFile.set(s.fileId, bucket);
  }
  const out: Record<string, HotExport[]> = {};
  for (const [fileId, exps] of byFile) {
    out[fileId] = exps.sort((a, b) => b.utilization - a.utilization).slice(0, 8);
  }
  return out;
}

export interface BlastRadiusEntry {
  symbolId: string;
  name: string;
  fileId: string;
  utilization: number;
  complexity: number;
  churn: number;
  score: number;
}

/**
 * Rank exports by blast radius = utilization × file cognitive complexity ×
 * file churn (C-53, "idea d"). Surfaces the single riskiest thing to touch: a
 * heavily-used export living in a file that is both hard to reason about and
 * actively changing. Stable files (churn 0) score 0 and drop out — a
 * load-bearing export in a calm file isn't a change hazard.
 */
export function buildBlastRadius(
  symbols: readonly SymbolUtil[],
  fileMetrics: ReadonlyMap<string, NodeMetrics>,
  churnByFile: ReadonlyMap<string, number>,
  limit = 15,
): BlastRadiusEntry[] {
  const out: BlastRadiusEntry[] = [];
  for (const s of symbols) {
    const complexity = fileMetrics.get(s.fileId)?.cognitiveMax ?? 0;
    const churn = churnByFile.get(s.fileId) ?? 0;
    const score = s.utilization * complexity * churn;
    if (score <= 0) continue;
    out.push({ symbolId: s.symbolId, name: s.name, fileId: s.fileId, utilization: s.utilization, complexity, churn, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
