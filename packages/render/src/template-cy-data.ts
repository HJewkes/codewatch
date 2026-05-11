import type { LayoutResult, RenderInput } from "./types.js";
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
  const nodes = layout.nodes.map((n) => {
    const status = diff?.nodeStatus[n.id] ?? "unchanged";
    const oldId = diff?.renames[n.id];
    const overlayFill = fills?.get(n.id);
    const metrics = metricsByNode.get(n.id) ?? {};
    const metricsBefore = metricsBeforeByNode.get(oldId ?? n.id) ?? {};
    const violation = violationsByNode.get(n.id);
    const violationSeverity: "error" | "warning" | undefined = violation
      ? violation.error > 0
        ? "error"
        : "warning"
      : undefined;
    const violationOrigin: "new" | "carryover" | undefined = violation
      ? violation.isCarryover
        ? "carryover"
        : "new"
      : undefined;
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
        ...(violationSeverity ? { violation_severity: violationSeverity } : {}),
        ...(violationOrigin ? { violation_origin: violationOrigin } : {}),
        ...(trend ? { violation_trend: trend } : {}),
        ...(resolved && resolved.length > 0 ? { resolved_count: resolved.length } : {}),
        width: n.width,
        height: n.height,
        ...(overlayFill ? { overlay_fill: overlayFill } : {}),
        raw: {
          ...n,
          status,
          ...(oldId ? { oldId } : {}),
          metrics,
          ...(Object.keys(metricsBefore).length > 0
            ? { metricsBefore }
            : {}),
          ...(violation ? { violations: violation.items } : {}),
          ...(resolved ? { resolvedViolations: resolved } : {}),
          ...(trendDetails ? { violationTrends: trendDetails } : {}),
          width: n.width,
          height: n.height,
        },
      },
      position: { x: n.x, y: n.y },
    };
  });
  const edges = layout.edges.map((e, i) => ({
    data: {
      id: `e${i}`,
      source: e.srcId,
      target: e.dstId,
      kind: e.kind,
      status:
        diff?.edgeStatus[`${e.srcId} ${e.dstId} ${e.kind}`] ?? "unchanged",
    },
  }));
  return { nodes, edges };
}
