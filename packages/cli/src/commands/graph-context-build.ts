import {
  computeSymbolConsumers,
  computeSymbolCoupling,
  parseSymbolId,
  type GraphNode,
  type ReferenceEdgeLite,
} from "@codewatch/graph";
import {
  buildBlastRadius,
  collectSymbolUtil,
  type BlastRadiusEntry,
  type NodeMetrics,
  type SymbolUtil,
} from "./dashboard-node-metrics.js";

/**
 * C-74 — deterministic per-file / per-symbol **context dossier** (Class A). A
 * pure projection of the already-computed graph: no LLM, no source re-parse. The
 * command layer (graph-context.ts) loads the snapshot and hands the assembled
 * inputs here; this module owns only the shaping + the markdown render, so it is
 * unit-testable on synthetic graphs.
 */

export interface Provenance {
  snapshotId: number;
  ref: string;
  commitHash: string | null;
  takenAt: string;
  indexVersion: string;
}

export interface FileOwnership {
  primaryOwner: string;
  busFactor: number;
  authorCount: number;
}

/** One of a file's declared symbols, projected for the dossier. */
export interface SymbolLine {
  name: string;
  exported: boolean;
  cognitive?: number;
  cyclomatic?: number;
  utilization: number;
  /** Distinct files that reference this symbol (inbound `references`). */
  consumers: number;
}

export interface SymbolDossier {
  exported: boolean;
  complexity: { cognitive?: number; cyclomatic?: number };
  utilization: number;
  consumers: string[];
  blastRadius: number;
  coupledWith: { symbolId: string; name: string; fileId: string; coImports: number }[];
}

export interface FileDossier {
  metrics: NodeMetrics;
  churn: { windowDays: number; value: number } | null;
  centrality: number;
  ownership: FileOwnership | null;
  symbols: SymbolLine[];
  dependsOn: string[];
  consumers: string[];
  blastRadius: BlastRadiusEntry[];
}

export interface ContextDossier {
  target: {
    id: string;
    kind: "file" | "symbol";
    name: string;
    path: string;
    span?: { startLine: number; endLine: number };
  };
  provenance: Provenance;
  symbol?: SymbolDossier;
  file?: FileDossier;
  notes: string[];
}

export interface ContextBuildInput {
  target: GraphNode;
  kind: "file" | "symbol";
  provenance: Provenance;
  /** All nodes for the snapshot, symbols INCLUDED. */
  nodes: readonly GraphNode[];
  /** `references` edges as {srcId=importing file, dstId=symbol id}. */
  refEdges: readonly ReferenceEdgeLite[];
  /** `imports` edges as {srcId, dstId} (file → file/external). */
  importEdges: readonly { srcId: string; dstId: string }[];
  metrics: ReadonlyMap<string, NodeMetrics>;
  churnByFile: ReadonlyMap<string, number>;
  churnWindowDays: number;
  centrality: ReadonlyMap<string, number>;
  ownership: ReadonlyMap<string, FileOwnership> | null;
}

/** Number of distinct importing files per symbol id (inbound `references`). */
function consumerCounts(
  edges: readonly ReferenceEdgeLite[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of computeSymbolConsumers(edges)) out.set(c.symbolId, c.consumers);
  return out;
}

function fileIdOf(symbolId: string): string | null {
  return parseSymbolId(symbolId)?.fileId ?? null;
}

function buildSymbolDossier(input: ContextBuildInput): SymbolDossier {
  const id = input.target.id;
  const parsed = parseSymbolId(id);
  const fileId = parsed?.fileId ?? "";
  const m = input.metrics.get(id);
  const consumers = consumerCounts(input.refEdges).get(id) ?? [];
  const complexity = m?.cognitiveMax ?? input.metrics.get(fileId)?.cognitiveMax ?? 0;
  const churn = input.churnByFile.get(fileId) ?? 0;
  const coupledWith = computeSymbolCoupling(input.refEdges)
    .filter((p) => p.aId === id || p.bId === id)
    .map((p) => (p.aId === id ? partner(p.bId, p.bName, p.bFile, p.coImports) : partner(p.aId, p.aName, p.aFile, p.coImports)))
    .slice(0, 15);
  return {
    exported: input.target.attrs?.exported !== false,
    complexity: { cognitive: m?.cognitiveMax, cyclomatic: m?.cyclomaticMax },
    utilization: m?.utilization ?? 0,
    consumers,
    blastRadius: (m?.utilization ?? 0) * complexity * churn,
    coupledWith,
  };
}

function partner(symbolId: string, name: string, fileId: string, coImports: number) {
  return { symbolId, name, fileId, coImports };
}

/** File's declared symbols, exports first (by utilization) then internals (by complexity). */
function fileSymbols(
  fileId: string,
  nodes: readonly GraphNode[],
  metrics: ReadonlyMap<string, NodeMetrics>,
  consumers: ReadonlyMap<string, string[]>,
): SymbolLine[] {
  const lines: (SymbolLine & { rank: number })[] = [];
  for (const n of nodes) {
    if (n.kind !== "symbol" || n.parentId !== fileId) continue;
    const m = metrics.get(n.id);
    const exported = n.attrs?.exported !== false;
    lines.push({
      name: n.name,
      exported,
      cognitive: m?.cognitiveMax,
      cyclomatic: m?.cyclomaticMax,
      utilization: m?.utilization ?? 0,
      consumers: (consumers.get(n.id) ?? []).length,
      rank: exported ? (m?.utilization ?? 0) : -(m?.cognitiveMax ?? 0),
    });
  }
  return sortSymbols(lines);
}

function sortSymbols(lines: (SymbolLine & { rank: number })[]): SymbolLine[] {
  const exported = lines
    .filter((l) => l.exported)
    .sort((a, b) => b.utilization - a.utilization || (b.cognitive ?? 0) - (a.cognitive ?? 0));
  const internal = lines
    .filter((l) => !l.exported)
    .sort((a, b) => (b.cognitive ?? 0) - (a.cognitive ?? 0) || a.name.localeCompare(b.name));
  return [...exported, ...internal].map(({ rank: _rank, ...line }) => line);
}

function fileConsumers(fileId: string, refEdges: readonly ReferenceEdgeLite[]): string[] {
  const set = new Set<string>();
  for (const e of refEdges) if (fileIdOf(e.dstId) === fileId) set.add(e.srcId);
  return [...set].sort();
}

function fileDependsOn(
  fileId: string,
  refEdges: readonly ReferenceEdgeLite[],
  importEdges: readonly { srcId: string; dstId: string }[],
): string[] {
  const set = new Set<string>();
  for (const e of refEdges) if (e.srcId === fileId) { const f = fileIdOf(e.dstId); if (f) set.add(f); }
  for (const e of importEdges) if (e.srcId === fileId) set.add(e.dstId);
  set.delete(fileId);
  return [...set].sort();
}

function buildFileDossier(input: ContextBuildInput): FileDossier {
  const fileId = input.target.id;
  const consumers = consumerCounts(input.refEdges);
  const symbolUtil: SymbolUtil[] = collectSymbolUtil(input.nodes, input.metrics).filter((s) => s.fileId === fileId);
  const churnValue = input.churnByFile.get(fileId);
  return {
    metrics: input.metrics.get(fileId) ?? {},
    churn: churnValue === undefined ? null : { windowDays: input.churnWindowDays, value: churnValue },
    centrality: input.centrality.get(fileId) ?? 0,
    ownership: input.ownership?.get(fileId) ?? null,
    symbols: fileSymbols(fileId, input.nodes, input.metrics, consumers),
    dependsOn: fileDependsOn(fileId, input.refEdges, input.importEdges),
    consumers: fileConsumers(fileId, input.refEdges),
    blastRadius: buildBlastRadius(symbolUtil, input.metrics, input.churnByFile, 15),
  };
}

const SIGNATURE_NOTE =
  "Full type signatures are not stored in the graph; open target.path at target.span for the declaration.";

export function buildContextDossier(input: ContextBuildInput): ContextDossier {
  const { target, kind } = input;
  const span = readSpan(target);
  const path = kind === "symbol" ? (parseSymbolId(target.id)?.fileId ?? target.id) : target.id;
  const notes: string[] = [SIGNATURE_NOTE];
  if (kind === "file" && input.ownership === null) {
    notes.push("Ownership omitted (git-derived; run without --no-ownership on a repo checkout).");
  }
  return {
    target: { id: target.id, kind, name: target.name, path, span },
    provenance: input.provenance,
    symbol: kind === "symbol" ? buildSymbolDossier(input) : undefined,
    file: kind === "file" ? buildFileDossier(input) : undefined,
    notes,
  };
}

function readSpan(node: GraphNode): { startLine: number; endLine: number } | undefined {
  const start = node.attrs?.startLine;
  const end = node.attrs?.endLine;
  if (typeof start === "number" && typeof end === "number") return { startLine: start, endLine: end };
  return undefined;
}
