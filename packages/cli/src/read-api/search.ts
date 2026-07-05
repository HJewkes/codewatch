import { parseSymbolId, type GraphNode } from "@codewatch/graph";
import type { SearchHit } from "./contract.js";

/**
 * Deterministic symbol/file lookup over the snapshot's nodes — an exact-id,
 * suffix, prefix, then substring cascade, ranked so the most specific match
 * wins. Pure over the node list, so it is unit-testable without a db.
 */
export function rankSearch(
  nodes: readonly GraphNode[],
  query: string,
  limit: number,
): SearchHit[] {
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const n of nodes) {
    if (n.kind !== "file" && n.kind !== "symbol") continue;
    const score = scoreNode(n, q);
    if (score > 0) hits.push(toHit(n, score));
  }
  return hits
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function scoreNode(node: GraphNode, q: string): number {
  const id = node.id.toLowerCase();
  const name = node.name.toLowerCase();
  if (id === q || name === q) return 100;
  if (id.endsWith(`/${q}`) || id.endsWith(`#${q}`)) return 80;
  if (name.startsWith(q)) return 60;
  if (id.includes(q)) return 40;
  if (name.includes(q)) return 30;
  return 0;
}

function toHit(node: GraphNode, score: number): SearchHit {
  const path = node.kind === "symbol" ? (parseSymbolId(node.id)?.fileId ?? node.id) : node.id;
  return { id: node.id, kind: node.kind, name: node.name, path, score };
}
