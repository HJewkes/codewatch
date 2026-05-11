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

function baseFilename(id: string): string {
  return id.split("/").pop() ?? id;
}

function labelForNode(
  node: { id: string; kind: string; name: string },
): string {
  if (node.kind === "external") return node.name || node.id;
  if (node.kind === "file") return baseFilename(node.id);
  return node.name || baseFilename(node.id);
}

export function metricMapFromList(
  metrics: readonly { nodeId: string; name: string; value: number | null }[] | undefined,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!metrics) return out;
  for (const m of metrics) {
    if (m.value === null || !Number.isFinite(m.value)) continue;
    let inner = out.get(m.nodeId);
    if (!inner) {
      inner = {};
      out.set(m.nodeId, inner);
    }
    inner[m.name] = m.value;
  }
  return out;
}

function violationFields(
  violation: ReturnType<ViolationsByNode["get"]>,
  trend: "worsened" | "improved" | undefined,
  resolvedCount: number,
): Partial<CytoscapeNodeData> {
  const out: Partial<CytoscapeNodeData> = {};
  if (violation) {
    out.violation_severity = violation.error > 0 ? "error" : "warning";
    out.violation_origin = violation.isCarryover ? "carryover" : "new";
  }
  if (trend) out.violation_trend = trend;
  if (resolvedCount > 0) out.resolved_count = resolvedCount;
  return out;
}

function rawExtras(
  oldId: string | undefined,
  metricsBefore: Record<string, number>,
  violation: ReturnType<ViolationsByNode["get"]>,
  resolved: Array<{ ruleId: string; message: string }> | undefined,
  trendDetails: Array<{ ruleId: string; before: number; after: number; delta: number }> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (oldId) out.oldId = oldId;
  if (Object.keys(metricsBefore).length > 0) out.metricsBefore = metricsBefore;
  if (violation) out.violations = violation.items;
  if (resolved) out.resolvedViolations = resolved;
  if (trendDetails) out.violationTrends = trendDetails;
  return out;
}

function buildNodeEntry(
  n: LaidOutNode,
  ctx: NodeAssemblyContext,
): { data: CytoscapeNodeData; position: { x: number; y: number } } {
  const { diff, fills, metricsByNode, metricsBeforeByNode, violationsByNode, diffSummary } = ctx;
  const status = diff?.nodeStatus[n.id] ?? "unchanged";
  const oldId = diff?.renames[n.id];
  const overlayFill = fills?.get(n.id);
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
      ...(n.role ? { role: n.role } : {}),
      tooltip: oldId ? `${oldId} → ${n.id}` : n.id,
      status,
      ...violationFields(violation, trend, resolved?.length ?? 0),
      width: n.width,
      height: n.height,
      ...(overlayFill ? { overlay_fill: overlayFill } : {}),
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
