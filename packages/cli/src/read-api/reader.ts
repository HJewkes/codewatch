import * as path from "node:path";
import {
  computeDeepAst,
  detectGitToplevel,
  findSimilarCapability,
  openDatabase,
  type DeepAst,
  type Embedder,
  type GraphDatabase,
  type SimilarResult,
} from "@codewatch/graph";
import { createOllamaEmbedder } from "../utils/ollama-embedder.js";
import { contextBundleFromDb } from "../commands/graph-context.js";
import type { ContextBundle } from "../commands/graph-context-bundle.js";
import {
  READ_API_VERSION,
  type ContextRecord,
  type GetContextOptions,
  type GraphReadApi,
  type ReadApiOptions,
  type SearchResult,
} from "./contract.js";
import { rankSearch } from "./search.js";

/**
 * C-81 — codewatch's stable, versioned read API. Import this module (not the
 * sqlite schema) to pull deterministic per-target context off a snapshot; the
 * db handle lives for the instance's lifetime (an MCP server / ingestor pulls
 * many targets against it), so callers must `close()` when done. The heavy
 * dossier assembly is reused per pull from the shared `graph context --bundle`
 * core; only deep AST is computed lazily.
 */
export {
  READ_API_VERSION,
  type GraphReadApi,
  type ReadApiOptions,
  type GetContextOptions,
  type ContextRecord,
  type ContextBundle,
  type BundleEdge,
  type BundleEdges,
  type SourceChunk,
  type DeepAst,
  type SearchHit,
  type SearchResult,
  type SimilarCandidate,
  type SimilarResult,
} from "./contract.js";

const DEFAULT_SEARCH_LIMIT = 20;

export function createReadApi(options: ReadApiOptions): GraphReadApi {
  const db = openDatabase(options.db);
  const repoRoot = options.repoRoot ?? detectGitToplevel(process.cwd());
  const ctx = { db: options.db, snapshot: options.snapshot };
  const embedder = options.embedder ?? createOllamaEmbedder();
  return {
    version: READ_API_VERSION,
    getContext: (target, opts) => getContext(db, repoRoot, ctx, target, opts),
    getSource: (target) => bundle(db, repoRoot, ctx, target).source,
    getNeighbors: (target) => bundle(db, repoRoot, ctx, target).edges,
    search: (query, limit) => search(db, ctx.snapshot, query, limit),
    findSimilar: (query, limit) =>
      findSimilar(db, ctx.snapshot, embedder, query, limit),
    close: () => db.close(),
  };
}

interface CtxOptions {
  db: string;
  snapshot?: number;
}

function bundle(
  db: GraphDatabase,
  repoRoot: string | null,
  opts: CtxOptions,
  target: string,
): ContextBundle {
  return contextBundleFromDb(db, target, opts, repoRoot);
}

function getContext(
  db: GraphDatabase,
  repoRoot: string | null,
  opts: CtxOptions,
  target: string,
  getOpts: GetContextOptions | undefined,
): ContextRecord {
  const record = bundle(db, repoRoot, opts, target);
  if (!getOpts?.includeDeepAst) return record;
  return { ...record, deepAst: deepAstFor(record, repoRoot) };
}

/** On-pull deep AST for the bundle's already-resolved target (C-81). */
function deepAstFor(record: ContextBundle, repoRoot: string | null): DeepAst | null {
  if (!repoRoot) return null;
  const t = record.dossier.target;
  return computeDeepAst({
    filePath: t.path,
    absPath: path.join(repoRoot, t.path),
    symbolName: t.kind === "symbol" ? t.name : undefined,
  });
}

function search(
  db: GraphDatabase,
  snapshotId: number | undefined,
  query: string,
  limit: number | undefined,
): SearchResult {
  const snap = resolveSnapshot(db, snapshotId);
  const nodes = db.listNodes(snap, { includeSymbols: true });
  return { query, hits: rankSearch(nodes, query, limit ?? DEFAULT_SEARCH_LIMIT) };
}

function findSimilar(
  db: GraphDatabase,
  snapshotId: number | undefined,
  embedder: Embedder,
  query: string,
  limit: number | undefined,
): Promise<SimilarResult> {
  const snap = resolveSnapshot(db, snapshotId);
  return findSimilarCapability(db, snap, query, embedder, { limit });
}

function resolveSnapshot(
  db: GraphDatabase,
  snapshotId: number | undefined,
): number {
  const snap =
    snapshotId !== undefined
      ? db.getSnapshot(snapshotId)
      : (db.listSnapshots({ limit: 1 })[0] ?? null);
  if (!snap) throw new Error("No snapshot found");
  return snap.id;
}
