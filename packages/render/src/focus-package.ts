import type { GraphEdge, GraphNode } from "@codewatch/graph";
import { edgeWeight } from "./edge-weight.js";
import type { RenderInput } from "./types.js";

/**
 * Within-package focus view: show one package's files in full and collapse every
 * other package to a single boundary "stub" node, so cross-package edges still
 * have a target without drowning the view in other packages' internals.
 *
 * The result is a FLAT graph (real file nodes + a few package-stub nodes, no
 * compound nesting), which is exactly what `computeLayout` + the client's
 * `elk-preset` path route as a layered orthogonal DAG. Only ever one package is
 * exploded, so this scales to large packages (cli ~77, graph ~60) without the
 * hairball the package collapse was built to avoid.
 *
 * - Only `file` nodes contribute (module twins carry no edges; external deps
 *   would drown the internal structure), matching `collapseToPackages`.
 * - Intra-package file→file edges are kept, parallel edges folded (summed
 *   reference counts on `attrs.weight`).
 * - A pkg file → other-pkg file edge becomes file → stub(other); an other-pkg
 *   file → pkg file edge becomes stub(other) → file. Aggregated by (endpoint,
 *   neighbour) with the summed reference counts on `attrs.weight`.
 */
export interface FocusOptions {
  /**
   * Include `test`-role files. Off by default: tests are leaves that each import
   * one source file, so they roughly double the node count and blow out the
   * layout width without revealing how the *production* code is structured — which
   * is the question a "package internal structure" view answers.
   */
  includeTests?: boolean;
}

export function focusPackage(
  input: RenderInput,
  pkg: string,
  opts: FocusOptions = {},
): RenderInput {
  const pkgOf = (id: string): string => {
    const m = id.match(/^packages\/([^/]+)/);
    return m ? m[1] : (id.split("/")[0] ?? id);
  };
  const kept = (n: { kind: string; role?: string }): boolean =>
    n.kind === "file" && (opts.includeTests || n.role !== "test");

  const fileNodes = input.nodes.filter((n) => kept(n) && pkgOf(n.id) === pkg);
  const fileIds = new Set(fileNodes.map((n) => n.id));
  const isFile = new Set(input.nodes.filter((n) => n.kind === "file").map((n) => n.id));

  const intra = new Map<string, number>(); // "[src,dst]" file→file within pkg
  const out = new Map<string, number>(); // "[fileId,neighbour]" pkg file → neighbour stub
  const inc = new Map<string, number>(); // "[neighbour,fileId]" neighbour stub → pkg file
  const neighbours = new Set<string>();

  for (const e of input.edges) {
    if (!isFile.has(e.srcId) || !isFile.has(e.dstId)) continue;
    const srcIn = fileIds.has(e.srcId);
    const dstIn = fileIds.has(e.dstId);
    const w = edgeWeight(e);
    if (srcIn && dstIn) {
      bump(intra, JSON.stringify([e.srcId, e.dstId]), w);
    } else if (srcIn && !dstIn) {
      const nb = pkgOf(e.dstId);
      if (nb === pkg) continue; // dst is an excluded (test) file in this package — drop, not a neighbour
      neighbours.add(nb);
      bump(out, JSON.stringify([e.srcId, nb]), w);
    } else if (!srcIn && dstIn) {
      const nb = pkgOf(e.srcId);
      if (nb === pkg) continue; // src is an excluded file in this package — drop, not a neighbour
      neighbours.add(nb);
      bump(inc, JSON.stringify([nb, e.dstId]), w);
    }
  }

  const stubNodes: GraphNode[] = [...neighbours].map((nb) => ({
    id: nb,
    kind: "package",
    name: nb,
    attrs: { stub: true },
  }));
  const nodes: GraphNode[] = [...fileNodes, ...stubNodes];

  const edges: GraphEdge[] = [
    ...foldEdges(intra),
    ...foldEdges(out),
    ...foldEdges(inc),
  ];

  return { snapshotId: input.snapshotId, nodes, edges, metrics: input.metrics };
}

function bump(m: Map<string, number>, key: string, amount: number): void {
  m.set(key, (m.get(key) ?? 0) + amount);
}

function foldEdges(m: Map<string, number>): GraphEdge[] {
  return [...m].map(([key, weight]) => {
    const [srcId, dstId] = JSON.parse(key) as [string, string];
    return { srcId, dstId, kind: "imports", attrs: { weight } };
  });
}

/** Package names with ≥1 file node, for the focus-view package picker. */
export function packagesInSnapshot(input: RenderInput): string[] {
  const pkgOf = (id: string): string => {
    const m = id.match(/^packages\/([^/]+)/);
    return m ? m[1] : (id.split("/")[0] ?? id);
  };
  const pkgs = new Set<string>();
  for (const n of input.nodes) if (n.kind === "file") pkgs.add(pkgOf(n.id));
  return [...pkgs].sort();
}
