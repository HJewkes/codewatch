import type { GraphEdge, GraphNode } from "@code-style/graph";
import type { RenderInput } from "./types.js";

/**
 * Collapse a file-level snapshot to a package-level dependency graph: one node
 * per package, one weighted edge per ordered cross-package pair. This is the
 * question the graph should answer on load ("how do the packages depend on each
 * other?") instead of a 561-node file+module hairball. The file-level graph
 * stays available as an opt-in drill-down.
 *
 * - Only `file` nodes contribute (the `module` twins carry no edges — they're the
 *   orphan grid — and `external` deps would drown the internal structure).
 * - Intra-package edges are dropped; parallel edges fold into one, their count
 *   kept on `attrs.weight` for edge-thickness styling.
 */
export function collapseToPackages(input: RenderInput): RenderInput {
  const pkgOf = (id: string): string => {
    const m = id.match(/^packages\/([^/]+)/);
    return m ? m[1] : (id.split("/")[0] ?? id);
  };

  const pkgByFile = new Map<string, string>();
  const fileCount = new Map<string, number>();
  for (const n of input.nodes) {
    if (n.kind !== "file") continue;
    const pkg = pkgOf(n.id);
    pkgByFile.set(n.id, pkg);
    fileCount.set(pkg, (fileCount.get(pkg) ?? 0) + 1);
  }

  const weights = new Map<string, number>();
  for (const e of input.edges) {
    const s = pkgByFile.get(e.srcId);
    const d = pkgByFile.get(e.dstId);
    if (!s || !d || s === d) continue;
    const key = JSON.stringify([s, d]); // JSON tuple key — no in-band separator
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [...fileCount].map(([pkg, count]) => ({
    id: pkg,
    kind: "package",
    name: pkg,
    attrs: { fileCount: count },
  }));
  const edges: GraphEdge[] = [...weights].map(([key, weight]) => {
    const [srcId, dstId] = JSON.parse(key) as [string, string];
    return { srcId, dstId, kind: "imports", attrs: { weight } };
  });

  return { snapshotId: input.snapshotId, nodes, edges };
}
