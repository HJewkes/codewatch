import { resolveBarrelEdges, type GraphEdge, type GraphNode } from "@codewatch/graph";
import { edgeWeight } from "./edge-weight.js";
import type { RenderInput } from "./types.js";

/**
 * Collapse a file-level snapshot to a **module** (directory) dependency graph:
 * one node per source directory, one weighted edge per ordered cross-directory
 * pair. This is the altitude between the 7-node package overview and the
 * file-level hairball — it shows how a repo's sub-modules actually depend on
 * one another.
 *
 * Runs on the BARREL-RESOLVED edge set first (C-55): edges that route through an
 * `index.ts` re-export hub are rewritten onto the files they truly forward to,
 * so the coupling a barrel would otherwise mask (every cross-package import
 * collapsing onto one package node) surfaces as real directory-to-directory
 * dependencies. Barrels stop being a flattering single edge and the genuine
 * structure — including spaghetti that should be reorganized — becomes visible
 * at a legible altitude.
 *
 * - Only source `file` nodes contribute: module twins carry no edges, externals
 *   would drown the internal structure, and test/fixture/config/script files are
 *   excluded so the graph shows product-code module structure (mirrors the focus
 *   view). This also stops stray root-level config files from becoming their own
 *   phantom "directory" nodes.
 * - Intra-directory edges are dropped; parallel edges fold into one, their
 *   summed reference counts kept (rounded — barrel redistribution yields
 *   fractional weights) on `attrs.weight` for edge-thickness styling.
 */
const SKIP_ROLES = new Set(["test", "fixture", "config", "script"]);

export function collapseToDirectories(input: RenderInput): RenderInput {
  const dirByFile = new Map<string, string>();
  const fileCount = new Map<string, number>();
  for (const n of input.nodes) {
    if (n.kind !== "file" || (n.role && SKIP_ROLES.has(n.role))) continue;
    const dir = dirOf(n.id);
    dirByFile.set(n.id, dir);
    fileCount.set(dir, (fileCount.get(dir) ?? 0) + 1);
  }

  const weights = new Map<string, number>();
  for (const e of resolveBarrelEdges(input.nodes, input.edges)) {
    const s = dirByFile.get(e.srcId);
    const d = dirByFile.get(e.dstId);
    if (!s || !d || s === d) continue;
    const key = JSON.stringify([s, d]); // JSON tuple key — no in-band separator
    weights.set(key, (weights.get(key) ?? 0) + edgeWeight(e));
  }

  const edges: GraphEdge[] = [...weights].map(([key, weight]) => {
    const [srcId, dstId] = JSON.parse(key) as [string, string];
    return { srcId, dstId, kind: "imports", attrs: { weight: Math.round(weight) } };
  });

  // Drop directories with no cross-directory coupling — after barrels dissolve,
  // a package-root dir whose surface lived only in its barrel reads as a
  // disconnected orphan and adds no signal.
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.srcId);
    connected.add(e.dstId);
  }
  const nodes: GraphNode[] = [...fileCount]
    .filter(([dir]) => connected.has(dir))
    .map(([dir, count]) => ({
      id: dir,
      kind: "package",
      name: moduleLabel(dir),
      attrs: { fileCount: count },
    }));

  return { snapshotId: input.snapshotId, nodes, edges };
}

/** The directory a file lives in (its id minus the final path segment). */
function dirOf(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

/** Readable module name: drop the `packages/` prefix and the `/src` segment. */
function moduleLabel(dir: string): string {
  return dir.replace(/^packages\//, "").replace(/\/src(?=\/|$)/, "") || dir;
}
