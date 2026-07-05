import * as path from "node:path";
import {
  computeDeepAst,
  detectGitToplevel,
  openDatabase,
  type DeepAst,
  type GraphDatabase,
} from "@codewatch/graph";
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

const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Open a read API bound to one graph.db. The db handle lives for the instance's
 * lifetime (an MCP server / ingestor pulls many targets against it), so callers
 * must `close()` when done. The heavy dossier assembly is reused per pull from
 * the shared `graph context --bundle` core; only deep AST is computed lazily.
 */
export function createReadApi(options: ReadApiOptions): GraphReadApi {
  const db = openDatabase(options.db);
  const repoRoot = options.repoRoot ?? detectGitToplevel(process.cwd());
  const ctxOptions = { db: options.db, snapshot: options.snapshot };
  return {
    version: READ_API_VERSION,
    getContext: (target, opts) => getContext(db, repoRoot, ctxOptions, target, opts),
    getSource: (target) => bundle(db, repoRoot, ctxOptions, target).source,
    getNeighbors: (target) => bundle(db, repoRoot, ctxOptions, target).edges,
    search: (query, limit) => search(db, ctxOptions.snapshot, query, limit),
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
  const snap =
    snapshotId !== undefined ? db.getSnapshot(snapshotId) : (db.listSnapshots({ limit: 1 })[0] ?? null);
  if (!snap) throw new Error("No snapshot found");
  const nodes = db.listNodes(snap.id, { includeSymbols: true });
  return { query, hits: rankSearch(nodes, query, limit ?? DEFAULT_SEARCH_LIMIT) };
}
