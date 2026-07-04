import {
  computeChangeCoupling,
  computePageRank,
  loadChurnEntries,
  matchesAny,
  type CoEditPair,
  type GraphEdge,
  type GraphMetric,
  type GraphNode,
} from "@codewatch/graph";
import type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  HotspotRow,
  TestCoverageRow,
} from "./graph-report-types.js";

const COMPLEXITY_METRICS = ["cognitive_max", "cyclomatic_max"] as const;

export interface ReportContext {
  nodes: readonly GraphNode[];
  nodeById: Map<string, GraphNode>;
  metricsByName: Map<string, Map<string, number>>;
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

export interface ReportContextInput {
  nodes: readonly GraphNode[];
  metrics: readonly GraphMetric[];
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

export function buildReportContext(input: ReportContextInput): ReportContext {
  const metricsByName = new Map<string, Map<string, number>>();
  for (const m of input.metrics) {
    if (m.value === null) continue;
    let bucket = metricsByName.get(m.name);
    if (!bucket) {
      bucket = new Map();
      metricsByName.set(m.name, bucket);
    }
    bucket.set(m.nodeId, m.value);
  }
  return {
    nodes: input.nodes,
    nodeById: new Map(input.nodes.map((n) => [n.id, n])),
    metricsByName,
    excluders: input.excluders,
    excludedRoles: input.excludedRoles,
    windowDays: input.windowDays,
  };
}

export function keepNode(ctx: ReportContext, nodeId: string): boolean {
  if (matchesAny(nodeId, ctx.excluders)) return false;
  const node = ctx.nodeById.get(nodeId);
  if (!node || node.kind !== "file") return false;
  if (node.role && ctx.excludedRoles.has(node.role)) return false;
  return true;
}

export function lookupMetric(
  ctx: ReportContext,
  name: string,
  nodeId: string,
): number | undefined {
  return ctx.metricsByName.get(name)?.get(nodeId);
}

function pickComplexityMetric(ctx: ReportContext): string {
  for (const m of COMPLEXITY_METRICS) {
    if (ctx.metricsByName.has(m)) return m;
  }
  return "cyclomatic_max";
}

export function topHotspots(
  ctx: ReportContext,
  limit: number,
): HotspotRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const complexityName = pickComplexityMetric(ctx);
  const rows: HotspotRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const churn = lookupMetric(ctx, churnName, node.id) ?? 0;
    const complexity = lookupMetric(ctx, complexityName, node.id) ?? 0;
    if (churn === 0 || complexity === 0) continue;
    const recency = lookupMetric(ctx, `recency_${ctx.windowDays}d`, node.id) ?? 1;
    rows.push({ nodeId: node.id, churn, complexity, recency, score: Math.round(churn * complexity * recency) });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

export function hotspotScoreOf(ctx: ReportContext, nodeId: string): number {
  if (!keepNode(ctx, nodeId)) return 0;
  const churn = lookupMetric(ctx, `churn_${ctx.windowDays}d`, nodeId) ?? 0;
  const complexity = lookupMetric(ctx, pickComplexityMetric(ctx), nodeId) ?? 0;
  if (churn === 0 || complexity === 0) return 0;
  return hotspotScore(ctx, nodeId, churn, complexity);
}

/**
 * churn × complexity, discounted by the file's recency so a freshly-authored
 * file's initial churn burst doesn't read as decay (see recency_{window}d). The
 * factor is 1 (no discount) for files older than the window or when git can't
 * supply an age. Rounded to keep scores integer-friendly for display/thresholds.
 */
function hotspotScore(ctx: ReportContext, nodeId: string, churn: number, complexity: number): number {
  const recency = lookupMetric(ctx, `recency_${ctx.windowDays}d`, nodeId) ?? 1;
  return Math.round(churn * complexity * recency);
}

export function busFactorOf(
  ctx: ReportContext,
  nodeId: string,
): number | undefined {
  return lookupMetric(ctx, `bus_factor_${ctx.windowDays}d`, nodeId);
}

export function topBusFactorRisks(
  ctx: ReportContext,
  limit: number,
): BusFactorRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const bfName = `bus_factor_${ctx.windowDays}d`;
  const shareName = `top_author_share_${ctx.windowDays}d`;
  const rows: BusFactorRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const bf = lookupMetric(ctx, bfName, node.id);
    if (bf === undefined || bf > 1) continue;
    rows.push({
      nodeId: node.id,
      busFactor: bf,
      topAuthorShare: lookupMetric(ctx, shareName, node.id) ?? 1,
      churn: lookupMetric(ctx, churnName, node.id) ?? 0,
    });
  }
  rows.sort((a, b) => b.churn - a.churn);
  return rows.slice(0, limit);
}

/**
 * Sources whose *test coverage* is a single-author silo (test bus factor = 1)
 * — the honest, role-split view: production code can be well-spread while the
 * tests that guard it are owned by one person (or vice versa).
 */
export function topTestCoverageRisks(
  ctx: ReportContext,
  limit: number,
): TestCoverageRow[] {
  const bfName = `test_bus_factor_${ctx.windowDays}d`;
  const shareName = `test_top_author_share_${ctx.windowDays}d`;
  const rows: TestCoverageRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const bf = lookupMetric(ctx, bfName, node.id);
    if (bf === undefined || bf > 1) continue;
    rows.push({
      nodeId: node.id,
      testBusFactor: bf,
      testTopAuthorShare: lookupMetric(ctx, shareName, node.id) ?? 1,
      linkedTests: lookupMetric(ctx, "linked_test_count", node.id) ?? 0,
    });
  }
  rows.sort((a, b) => b.linkedTests - a.linkedTests);
  return rows.slice(0, limit);
}

export function topCouplingClusters(
  ctx: ReportContext,
  repoRoot: string,
  windowDays: number,
  limit: number,
): CouplingRow[] {
  const entries = loadChurnEntries({
    repoRoot,
    windowDays,
    knownFileIds: collectKeptFileIds(ctx),
  });
  if (entries === null) return [];
  const { pairs } = computeChangeCoupling(entries, { minCount: 2 });
  const filtered = pairs.filter(
    (p) => keepNode(ctx, p.fileA) && keepNode(ctx, p.fileB),
  );
  return filtered.slice(0, limit).map(toCouplingRow);
}

function toCouplingRow(p: CoEditPair): CouplingRow {
  return { fileA: p.fileA, fileB: p.fileB, count: p.count };
}

export function topCentralFiles(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ctx: ReportContext,
  limit: number,
): CentralRow[] {
  const pageRank = computePageRank(nodes, edges, {});
  const rows: CentralRow[] = [];
  for (const r of pageRank.rows) {
    if (!keepNode(ctx, r.nodeId)) continue;
    rows.push({ nodeId: r.nodeId, score: r.score });
    if (rows.length >= limit) break;
  }
  return rows;
}

function collectKeptFileIds(ctx: ReportContext): Set<string> {
  const out = new Set<string>();
  for (const node of ctx.nodes) if (keepNode(ctx, node.id)) out.add(node.id);
  return out;
}
