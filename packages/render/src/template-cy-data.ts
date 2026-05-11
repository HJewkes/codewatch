import type { LaidOutNode, LayoutResult, RenderInput } from "./types.js";
import type { DiffSummary, ViolationsByNode } from "./template-violations.js";

interface CytoscapeNodeData {
  id: string;
  label: string;
  kind: string;
  role?: string;
  tooltip: string;
  status: string;
  violation_severity?: "error" | "warning";
  violation_origin?: "new" | "carryover";
  violation_trend?: "worsened" | "improved";
  resolved_count?: number;
  width: number;
  height: number;
  overlay_fill?: string;
  raw: unknown;
}

interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  kind: string;
  status: string;
}

interface NodeAssemblyContext {
  diff: RenderInput["diff"];
  fills: Map<string, string> | null;
  metricsByNode: Map<string, Record<string, number>>;
  metricsBeforeByNode: Map<string, Record<string, number>>;
  violationsByNode: ViolationsByNode;
  diffSummary: DiffSummary;
}

type Violation = ReturnType<ViolationsByNode["get"]>;
type ResolvedList = Array<{ ruleId: string; message: string }>;
type TrendList = Array<{ ruleId: string; before: number; after: number; delta: number }>;

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function baseFilename(id: string): string {
  return id.split("/").pop() ?? id;
}

function externalLabel(node: { id: string; name: string }): string {
  return node.name || node.id;
}

function symbolLabel(node: { id: string; name: string }): string {
  return node.name || baseFilename(node.id);
}

function labelForNode(
  node: { id: string; kind: string; name: string },
): string {
  if (node.kind === "file") return baseFilename(node.id);
  if (node.kind === "external") return externalLabel(node);
  return symbolLabel(node);
}

function isValidMetric(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function recordMetric(
  out: Map<string, Record<string, number>>,
  m: { nodeId: string; name: string; value: number | null },
): void {
  if (!isValidMetric(m.value)) return;
  let inner = out.get(m.nodeId);
  if (!inner) {
    inner = {};
    out.set(m.nodeId, inner);
  }
  inner[m.name] = m.value;
}

export function metricMapFromList(
  metrics: readonly { nodeId: string; name: string; value: number | null }[] | undefined,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!metrics) return out;
  metrics.forEach((m) => recordMetric(out, m));
  return out;
}

function severityOf(v: Violation): "error" | "warning" | undefined {
  if (!v) return undefined;
  return v.error > 0 ? "error" : "warning";
}

function originOf(v: Violation): "new" | "carryover" | undefined {
  if (!v) return undefined;
  return v.isCarryover ? "carryover" : "new";
}

function resolvedCountOf(r: ResolvedList | undefined): number | undefined {
  return r && r.length > 0 ? r.length : undefined;
}

function violationFields(
  v: Violation,
  trend: "worsened" | "improved" | undefined,
  resolved: ResolvedList | undefined,
): Partial<CytoscapeNodeData> {
  return compact({
    violation_severity: severityOf(v),
    violation_origin: originOf(v),
    violation_trend: trend,
    resolved_count: resolvedCountOf(resolved),
  });
}

function rawExtras(
  oldId: string | undefined,
  metricsBefore: Record<string, number>,
  violation: Violation,
  resolved: ResolvedList | undefined,
  trendDetails: TrendList | undefined,
): Record<string, unknown> {
  const hasBefore = Object.keys(metricsBefore).length > 0;
  return compact({
    oldId,
    metricsBefore: hasBefore ? metricsBefore : undefined,
    violations: violation?.items,
    resolvedViolations: resolved,
    violationTrends: trendDetails,
  });
}

function tooltipFor(nodeId: string, oldId: string | undefined): string {
  return oldId ? `${oldId} → ${nodeId}` : nodeId;
}

function roleField(role: string | undefined): { role?: string } {
  return role ? { role } : {};
}

function overlayFillField(fill: string | undefined): { overlay_fill?: string } {
  return fill ? { overlay_fill: fill } : {};
}

function buildNodeEntry(
  n: LaidOutNode,
  ctx: NodeAssemblyContext,
): { data: CytoscapeNodeData; position: { x: number; y: number } } {
  const { diff, fills, metricsByNode, metricsBeforeByNode, violationsByNode, diffSummary } = ctx;
  const status = diff?.nodeStatus[n.id] ?? "unchanged";
  const oldId = diff?.renames[n.id];
  const metrics = metricsByNode.get(n.id) ?? {};
  const metricsBefore = metricsBeforeByNode.get(oldId ?? n.id) ?? {};
  const violation = violationsByNode.get(n.id);
  const trend = diffSummary.trendByNode.get(n.id);
  const resolved = diffSummary.resolvedByNode.get(n.id);
  const trendDetails = diffSummary.trendDetailsByNode.get(n.id);
  return {
    data: {
      id: n.id,
      label: labelForNode(n),
      kind: n.kind,
      ...roleField(n.role),
      tooltip: tooltipFor(n.id, oldId),
      status,
      ...violationFields(violation, trend, resolved),
      width: n.width,
      height: n.height,
      ...overlayFillField(fills?.get(n.id)),
      raw: {
        ...n,
        status,
        metrics,
        width: n.width,
        height: n.height,
        ...rawExtras(oldId, metricsBefore, violation, resolved, trendDetails),
      },
    },
    position: { x: n.x, y: n.y },
  };
}

function buildEdgeEntry(
  e: LayoutResult["edges"][number],
  i: number,
  diff: RenderInput["diff"],
): { data: CytoscapeEdgeData } {
  return {
    data: {
      id: `e${i}`,
      source: e.srcId,
      target: e.dstId,
      kind: e.kind,
      status: diff?.edgeStatus[`${e.srcId} ${e.dstId} ${e.kind}`] ?? "unchanged",
    },
  };
}

export function buildCyData(
  layout: LayoutResult,
  diff: RenderInput["diff"],
  fills: Map<string, string> | null,
  metricsByNode: Map<string, Record<string, number>>,
  metricsBeforeByNode: Map<string, Record<string, number>>,
  violationsByNode: ViolationsByNode,
  diffSummary: DiffSummary,
): {
  nodes: Array<{ data: CytoscapeNodeData; position: { x: number; y: number } }>;
  edges: Array<{ data: CytoscapeEdgeData }>;
} {
  const ctx: NodeAssemblyContext = {
    diff, fills, metricsByNode, metricsBeforeByNode, violationsByNode, diffSummary,
  };
  return {
    nodes: layout.nodes.map((n) => buildNodeEntry(n, ctx)),
    edges: layout.edges.map((e, i) => buildEdgeEntry(e, i, diff)),
  };
}
