import { parseSymbolId, type GraphEdge, type GraphNode } from "@titan-design/code-graph";
import type { LineRange } from "./audit-changed.js";
import { lineAttr } from "./audit-collect.js";

export function callersByCallee(edges: readonly GraphEdge[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "calls" || e.srcId === e.dstId) continue;
    const list = out.get(e.dstId);
    if (list) list.push(e.srcId);
    else out.set(e.dstId, [e.srcId]);
  }
  return out;
}

/** Test functions that reach `id` through `calls` edges, walking callers upward. */
export function reachingTests(id: string, callers: ReadonlyMap<string, readonly string[]>, isTest: (id: string) => boolean): string[] {
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const caller of callers.get(queue.pop()!) ?? []) {
      if (seen.has(caller)) continue;
      seen.add(caller);
      queue.push(caller);
    }
  }
  return [...seen].filter(isTest);
}

export function spanOf(node: GraphNode): LineRange | undefined {
  const start = lineAttr(node, "startLine");
  const end = lineAttr(node, "endLine");
  return start === undefined || end === undefined ? undefined : { start, end };
}

export function citation(id: string, nodes: ReadonlyMap<string, GraphNode>): string {
  const fileId = parseSymbolId(id)?.fileId ?? id;
  const node = nodes.get(id);
  const span = node && spanOf(node);
  return span ? `${fileId}:${span.start}-${span.end}` : fileId;
}
