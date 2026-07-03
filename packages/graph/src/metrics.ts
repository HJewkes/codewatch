import type { GraphEdge, GraphMetric, GraphNode } from "./types.js";

interface DegreeCounts {
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
  /**
   * Utilization: inbound edges weighted by their reference count (C-51's
   * `attrs.weight`), so it measures how heavily a file's exports are actually
   * *used*, not merely how many files name it. Falls back to 1 per edge for
   * unweighted edge kinds, so utilization ≥ fan_in always. Computed over the
   * fully-assembled edge set, so it stays correct under incremental reuse.
   */
  weightedFanIn: Map<string, number>;
}

function edgeWeight(e: GraphEdge): number {
  const w = (e.attrs as { weight?: number } | undefined)?.weight;
  return typeof w === "number" && w > 0 ? w : 1;
}

function countDegrees(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): DegreeCounts {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const weightedFanIn = new Map<string, number>();
  for (const n of nodes) {
    fanIn.set(n.id, 0);
    fanOut.set(n.id, 0);
    weightedFanIn.set(n.id, 0);
  }
  for (const e of edges) {
    if (fanOut.has(e.srcId)) {
      fanOut.set(e.srcId, fanOut.get(e.srcId)! + 1);
    }
    if (fanIn.has(e.dstId)) {
      fanIn.set(e.dstId, fanIn.get(e.dstId)! + 1);
      weightedFanIn.set(e.dstId, weightedFanIn.get(e.dstId)! + edgeWeight(e));
    }
  }
  return { fanIn, fanOut, weightedFanIn };
}

export function computeMetrics(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphMetric[] {
  const { fanIn, fanOut, weightedFanIn } = countDegrees(nodes, edges);
  const out: GraphMetric[] = [];
  for (const n of nodes) {
    const ci = fanIn.get(n.id) ?? 0;
    const co = fanOut.get(n.id) ?? 0;
    const util = weightedFanIn.get(n.id) ?? 0;
    out.push({ nodeId: n.id, name: "fan_in", value: ci, unit: "count" });
    out.push({ nodeId: n.id, name: "fan_out", value: co, unit: "count" });
    out.push({ nodeId: n.id, name: "utilization", value: util, unit: "count" });
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
