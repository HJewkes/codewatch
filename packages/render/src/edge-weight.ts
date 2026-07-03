import type { GraphEdge } from "@codewatch/graph";

/**
 * The reference-count weight the extractor stamps on a file-level import edge
 * (C-51), falling back to 1 for edges that predate the field or carry a
 * non-positive value. Package-level rollups sum this so a package pair bridged
 * by one heavily-used file reads as heavier than one bridged by many light
 * links — reference volume, not link count.
 */
export function edgeWeight(edge: GraphEdge): number {
  const w = edge.attrs?.weight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}
