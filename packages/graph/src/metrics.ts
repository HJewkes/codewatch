import type { GraphEdge, GraphMetric, GraphNode } from "./types.js";

interface DegreeCounts {
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
}

function countDegrees(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): DegreeCounts {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const n of nodes) {
    fanIn.set(n.id, 0);
    fanOut.set(n.id, 0);
  }
  for (const e of edges) {
    if (fanOut.has(e.srcId)) {
      fanOut.set(e.srcId, fanOut.get(e.srcId)! + 1);
    }
    if (fanIn.has(e.dstId)) {
      fanIn.set(e.dstId, fanIn.get(e.dstId)! + 1);
    }
  }
  return { fanIn, fanOut };
}

export function computeMetrics(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphMetric[] {
  const { fanIn, fanOut } = countDegrees(nodes, edges);
  const out: GraphMetric[] = [];
  for (const n of nodes) {
    const ci = fanIn.get(n.id) ?? 0;
    const co = fanOut.get(n.id) ?? 0;
    out.push({ nodeId: n.id, name: "fan_in", value: ci, unit: "count" });
    out.push({ nodeId: n.id, name: "fan_out", value: co, unit: "count" });
    if (ci + co > 0) {
      out.push({
        nodeId: n.id,
        name: "instability",
        value: co / (ci + co),
        unit: "ratio",
      });
    }
  }
  return out;
}
