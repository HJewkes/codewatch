import {
  detectGitToplevel,
  getEdgeWeight,
  loadChurnEntries,
  type EdgeKind,
  type GraphEdge,
} from "@code-style/graph";

export interface RelevantVia {
  nodeId: string;
  /** Approximate rank contribution: predecessor score × edge weight. */
  weight: number;
}

export interface RelevantAuthor {
  /** git author email (%ae). */
  author: string;
  /** Fraction of 30d churn lines from this author (0..1). */
  share: number;
}

export interface ExplainRow {
  nodeId: string;
  kind: string;
}

export interface RowExplanation<R extends ExplainRow> {
  row: R;
  via: RelevantVia | null;
  topAuthor: RelevantAuthor | null;
}

export function buildExplanations<R extends ExplainRow>(
  rows: readonly R[],
  edges: readonly GraphEdge[],
  ranked: readonly { nodeId: string; score: number }[],
  repoRoot: string | undefined,
): RowExplanation<R>[] {
  const scoreById = new Map(ranked.map((r) => [r.nodeId, r.score]));
  const inbound = buildInboundIndex(edges);
  const authorByFile = buildTopAuthorMap(repoRoot ?? process.cwd());
  return rows.map((r) => ({
    row: r,
    via: topInbound(r.nodeId, inbound, scoreById),
    topAuthor: r.kind === "file" ? (authorByFile.get(r.nodeId) ?? null) : null,
  }));
}

function buildInboundIndex(
  edges: readonly GraphEdge[],
): Map<string, Array<{ src: string; kind: EdgeKind }>> {
  const inbound = new Map<string, Array<{ src: string; kind: EdgeKind }>>();
  for (const e of edges) {
    let list = inbound.get(e.dstId);
    if (!list) {
      list = [];
      inbound.set(e.dstId, list);
    }
    list.push({ src: e.srcId, kind: e.kind });
  }
  return inbound;
}

function topInbound(
  nodeId: string,
  inbound: ReadonlyMap<string, ReadonlyArray<{ src: string; kind: EdgeKind }>>,
  scoreById: ReadonlyMap<string, number>,
): RelevantVia | null {
  const preds = inbound.get(nodeId);
  if (!preds || preds.length === 0) return null;
  let best: RelevantVia | null = null;
  for (const p of preds) {
    const contribution = (scoreById.get(p.src) ?? 0) * getEdgeWeight(p.kind);
    if (best === null || contribution > best.weight) {
      best = { nodeId: p.src, weight: contribution };
    }
  }
  return best;
}

function buildTopAuthorMap(repoRoot: string): Map<string, RelevantAuthor> {
  const gitRoot = detectGitToplevel(repoRoot);
  const entries = gitRoot === null ? null : loadChurnEntries({ repoRoot: gitRoot });
  if (!entries) return new Map();
  const byFile = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const lines = e.added + e.deleted;
    if (lines === 0) continue;
    let m = byFile.get(e.filePath);
    if (!m) {
      m = new Map();
      byFile.set(e.filePath, m);
    }
    m.set(e.author, (m.get(e.author) ?? 0) + lines);
  }
  const out = new Map<string, RelevantAuthor>();
  for (const [file, m] of byFile) {
    const top = pickTopAuthor(m);
    if (top) out.set(file, top);
  }
  return out;
}

function pickTopAuthor(
  m: ReadonlyMap<string, number>,
): RelevantAuthor | null {
  let topAuthor = "";
  let topLines = 0;
  let total = 0;
  for (const [a, n] of m) {
    total += n;
    if (n > topLines) {
      topAuthor = a;
      topLines = n;
    }
  }
  if (total === 0) return null;
  return { author: topAuthor, share: topLines / total };
}
