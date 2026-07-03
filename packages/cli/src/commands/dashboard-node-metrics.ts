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
}

/** Metric name → NodeMetrics field, for the structural metrics the Dossier heats. */
const METRIC_FIELD: Record<string, keyof NodeMetrics> = {
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

/**
 * Structural metrics for every file the Dossier can open on (any node referenced
 * in hotspots / silos / coupling / test-coverage / drift). Scoped to referenced
 * nodes rather than the whole graph to keep the payload tight — the Dossier never
 * opens on an unreferenced file.
 */
export function buildNodeMetrics(
  report: ReturnType<typeof runGraphReportCommand>,
  metrics: ReadonlyMap<string, NodeMetrics>,
): Record<string, NodeMetrics> {
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
  const out: Record<string, NodeMetrics> = {};
  for (const id of referenced) {
    const m = metrics.get(id);
    if (m) out[id] = m;
  }
  return out;
}
