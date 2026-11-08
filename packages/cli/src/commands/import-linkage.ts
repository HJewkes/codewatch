import type { GraphEdge } from "@titan-design/code-graph";

/** Which file pairs a static import joins, and which files have any internal import. */
export interface ImportLinkage {
  linkedPairs: ReadonlySet<string>;
  /**
   * Ids of files that participate in at least one *internal* (repo-to-repo)
   * import/re-export edge. A file missing here has no resolved imports in the
   * graph — either it isn't indexed, or its imports couldn't be resolved (e.g. a
   * dir outside the tsconfig project, whose relative specifiers resolve to junk).
   * Either way the import evidence is absent, so a co-change touching it can't be
   * called hidden-vs-import-backed; it's "unverifiable", not "hidden".
   */
  connectedNodes: ReadonlySet<string>;
}

/** Order-independent key for an undirected file pair (JSON tuple; no in-band separator). */
export function pairKey(a: string, b: string): string {
  return a < b ? JSON.stringify([a, b]) : JSON.stringify([b, a]);
}

/** External import target (an npm package or an unresolved specifier), not a repo file. */
function isExternal(id: string): boolean {
  return id.startsWith("npm:");
}

export type CouplingClass = { hidden: boolean; unindexed: boolean };

/**
 * Classify a co-changed pair against the static import graph:
 * - unindexed: an endpoint has no resolved internal imports → can't tell (not hidden).
 * - hidden: both connected, but no import/re-export edge joins them → the signal.
 * - expected: both connected and import-backed → usually fine.
 */
export function classifyCoupling(a: string, b: string, linkage: ImportLinkage): CouplingClass {
  const unindexed = !linkage.connectedNodes.has(a) || !linkage.connectedNodes.has(b);
  if (unindexed) return { hidden: false, unindexed: true };
  return { hidden: !linkage.linkedPairs.has(pairKey(a, b)), unindexed: false };
}

export function importLinkage(edges: readonly GraphEdge[]): ImportLinkage {
  const linkedPairs = new Set<string>();
  const connectedNodes = new Set<string>();
  for (const e of edges) {
    if (e.kind !== "imports" && e.kind !== "re-exports") continue;
    // Only repo-to-repo edges count as connectivity — an edge to an npm:*
    // package (or an unresolved specifier) says nothing about internal coupling.
    if (isExternal(e.srcId) || isExternal(e.dstId)) continue;
    linkedPairs.add(pairKey(e.srcId, e.dstId));
    connectedNodes.add(e.srcId);
    connectedNodes.add(e.dstId);
  }
  return { linkedPairs, connectedNodes };
}
