import type { GraphDatabase } from "./database.js";
import type { GraphEdge, GraphNode } from "./types.js";

export interface RuleContext {
  nodes: readonly GraphNode[];
  nodesById: Map<string, GraphNode>;
  metricsByNode: Map<string, Map<string, number>>;
  edges: readonly GraphEdge[];
}

export function buildRuleContext(
  db: GraphDatabase,
  snapshotId: number,
): RuleContext {
  const nodes = db.listNodes(snapshotId);
  const edges = db.listEdges(snapshotId);
  const metrics = db.listMetrics(snapshotId);
  const nodesById = new Map<string, GraphNode>();
  for (const n of nodes) nodesById.set(n.id, n);
  const metricsByNode = new Map<string, Map<string, number>>();
  for (const m of metrics) {
    if (m.value === null) continue;
    let inner = metricsByNode.get(m.nodeId);
    if (!inner) {
      inner = new Map();
      metricsByNode.set(m.nodeId, inner);
    }
    inner.set(m.name, m.value);
  }
  return { nodes, nodesById, metricsByNode, edges };
}
