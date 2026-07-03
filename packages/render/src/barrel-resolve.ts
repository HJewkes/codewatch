import { resolveBarrelEdges } from "@codewatch/graph";
import type { RenderInput } from "./types.js";

/**
 * De-hub a file-level graph: rewrite edges that route through a `role="barrel"`
 * `index.ts` re-export file onto the files the barrel actually forwards to
 * (weighted, via {@link resolveBarrelEdges}), then drop the now-dissolved
 * barrel nodes. Without this, every cross-package `import … from "@codewatch/x"`
 * lands on package x's barrel, so the barrel renders as a false hub that all
 * dependencies fan through — obscuring which module actually does the work.
 *
 * A dead-end barrel (nothing resolvable to forward to) keeps its inbound edge
 * and its node, so no dependency vanishes.
 */
export function resolveBarrels(input: RenderInput): RenderInput {
  const edges = resolveBarrelEdges(input.nodes, input.edges);
  const referenced = new Set<string>();
  for (const e of edges) {
    referenced.add(e.srcId);
    referenced.add(e.dstId);
  }
  const nodes = input.nodes.filter(
    (n) => n.role !== "barrel" || referenced.has(n.id),
  );
  return { ...input, nodes, edges };
}
