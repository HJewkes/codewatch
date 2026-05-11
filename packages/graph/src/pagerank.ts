import type { EdgeKind, GraphEdge, GraphNode } from "./types.js";

export interface PageRankOptions {
  /** Per-node teleport weight. Unset or empty → uniform teleport across all nodes. */
  personalization?: ReadonlyMap<string, number>;
  /** Probability of following an edge vs teleporting (default 0.85). */
  damping?: number;
  /** L1 convergence threshold (default 1e-6). */
  tolerance?: number;
  /** Cap on power-iteration steps (default 100). */
  maxIterations?: number;
  /** Per-kind edge weight; missing kinds default to 1.0. */
  edgeWeights?: Partial<Record<EdgeKind, number>>;
}

export interface PageRankRow {
  nodeId: string;
  score: number;
}

export interface PageRankResult {
  /** Sorted descending by score; ties broken by node id ascending. */
  rows: PageRankRow[];
  iterations: number;
  converged: boolean;
}

const DEFAULT_DAMPING = 0.85;
const DEFAULT_TOLERANCE = 1e-6;
const DEFAULT_MAX_ITERS = 100;

const DEFAULT_EDGE_WEIGHTS: Record<EdgeKind, number> = {
  imports: 1.0,
  "re-exports": 0.5,
  calls: 1.5,
  extends: 1.0,
  implements: 1.0,
  references: 1.0,
  "depends-on": 1.0,
};

export function computePageRank(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: PageRankOptions = {},
): PageRankResult {
  const n = nodes.length;
  if (n === 0) return { rows: [], iterations: 0, converged: true };

  const damping = options.damping ?? DEFAULT_DAMPING;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIters = options.maxIterations ?? DEFAULT_MAX_ITERS;
  const weights = { ...DEFAULT_EDGE_WEIGHTS, ...(options.edgeWeights ?? {}) };

  const idx = new Map<string, number>();
  for (let i = 0; i < n; i++) idx.set(nodes[i]!.id, i);

  const outNeighbors: Array<Array<{ to: number; w: number }>> = Array.from(
    { length: n },
    () => [],
  );
  const outWeightSum = new Array<number>(n).fill(0);
  for (const e of edges) {
    const si = idx.get(e.srcId);
    const di = idx.get(e.dstId);
    if (si === undefined || di === undefined) continue;
    const w = weights[e.kind] ?? 1.0;
    if (w <= 0) continue;
    outNeighbors[si]!.push({ to: di, w });
    outWeightSum[si]! += w;
  }

  const pers = buildPersonalization(idx, n, options.personalization);

  let rank = pers.slice();
  let next = new Array<number>(n).fill(0);

  let iterations = 0;
  let converged = false;
  for (let iter = 0; iter < maxIters; iter++) {
    iterations = iter + 1;

    let danglingMass = 0;
    for (let i = 0; i < n; i++) {
      if (outWeightSum[i]! === 0) danglingMass += rank[i]!;
    }

    const teleportFromPers = (1 - damping) + damping * danglingMass;
    for (let i = 0; i < n; i++) {
      next[i] = teleportFromPers * pers[i]!;
    }

    for (let i = 0; i < n; i++) {
      const s = outWeightSum[i]!;
      if (s === 0) continue;
      const r = rank[i]!;
      if (r === 0) continue;
      const factor = (damping * r) / s;
      const list = outNeighbors[i]!;
      for (let k = 0; k < list.length; k++) {
        const edge = list[k]!;
        next[edge.to]! += factor * edge.w;
      }
    }

    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(next[i]! - rank[i]!);

    const tmp = rank;
    rank = next;
    next = tmp;
    next.fill(0);

    if (diff < tolerance) {
      converged = true;
      break;
    }
  }

  const rows: PageRankRow[] = nodes
    .map((node, i) => ({ nodeId: node.id, score: rank[i]! }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
    });

  return { rows, iterations, converged };
}

function buildPersonalization(
  idx: ReadonlyMap<string, number>,
  n: number,
  pers: PageRankOptions["personalization"],
): number[] {
  const out = new Array<number>(n).fill(0);
  if (!pers || pers.size === 0) {
    const uniform = 1 / n;
    for (let i = 0; i < n; i++) out[i] = uniform;
    return out;
  }
  let total = 0;
  for (const [id, w] of pers) {
    const i = idx.get(id);
    if (i === undefined || !Number.isFinite(w) || w <= 0) continue;
    out[i] = w;
    total += w;
  }
  if (total === 0) {
    const uniform = 1 / n;
    for (let i = 0; i < n; i++) out[i] = uniform;
    return out;
  }
  for (let i = 0; i < n; i++) out[i]! /= total;
  return out;
}
