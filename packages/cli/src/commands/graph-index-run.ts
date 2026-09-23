import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  detectGitToplevel,
  indexPaths,
  openCodeGraph,
  type IndexOptions,
} from "@titan-design/code-graph";
import { moveLegacyGraphDbAside } from "../utils/graph-store.js";

export interface GraphIndexOptions extends Omit<IndexOptions, "paths" | "tsConfig"> {
  /** Single root to index; equivalent to `rootDirs: [rootDir]`. */
  rootDir?: string;
  rootDirs?: string[];
  dbPath?: string;
  tsConfigPath?: string;
  /** Receives the one-line notice when a legacy database is renamed aside. */
  onNotice?: (line: string) => void;
}

/** The CLI's stable `graph index --json` shape over the package's `IndexResult`. */
export interface GraphIndexResult {
  dbPath: string;
  snapshotId: number;
  files: number;
  nodes: number;
  edges: number;
  aliases: number;
  metrics: number;
  reusedFiles: number;
  reparsedFiles: number;
  cosmeticFiles: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  durationMs: { total: number };
}

function normalizeRootDirs(options: GraphIndexOptions): string[] {
  const roots = [
    ...(options.rootDir ? [options.rootDir] : []),
    ...(options.rootDirs ?? []),
  ].map((p) => path.resolve(p));
  if (roots.length === 0) {
    throw new Error("graph index: provide rootDir or rootDirs");
  }
  return roots;
}

/** Default the db to the git toplevel, where node ids are rooted, not the indexed subdir (C-22). */
export function resolveIndexDbPath(dbPath: string | undefined, firstRoot: string): string {
  if (dbPath) return path.resolve(dbPath);
  const idRoot = detectGitToplevel(firstRoot) ?? firstRoot;
  return path.join(idRoot, ".codewatch", "graph.db");
}

function toIndexOptions(options: GraphIndexOptions, paths: string[]): IndexOptions {
  return {
    paths,
    ref: options.ref,
    commitHash: options.commitHash,
    tsConfig: options.tsConfigPath,
    detectRenames: options.detectRenames,
    computeMetrics: options.computeMetrics,
    incremental: options.incremental,
    computeChurn: options.computeChurn,
    churnWindowDays: options.churnWindowDays,
    churnWindows: options.churnWindows,
    lifetime: options.lifetime,
  };
}

export async function runGraphIndex(options: GraphIndexOptions): Promise<GraphIndexResult> {
  const started = performance.now();
  const rootDirs = normalizeRootDirs(options);
  const dbPath = resolveIndexDbPath(options.dbPath, rootDirs[0]!);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const aside = moveLegacyGraphDbAside(dbPath);
  if (aside) {
    (options.onNotice ?? console.error)(
      `codewatch: ${dbPath} predates codewatch 0.2; renamed it to ${aside} and started a fresh index`,
    );
  }
  const store = openCodeGraph(dbPath);
  try {
    const result = await indexPaths(store, toIndexOptions(options, rootDirs));
    return {
      dbPath,
      snapshotId: result.snapshotId,
      files: result.files,
      nodes: result.nodes,
      edges: result.edges,
      aliases: result.aliases,
      metrics: result.metrics,
      reusedFiles: result.reused,
      reparsedFiles: result.reparsed,
      cosmeticFiles: result.cosmetic,
      nodesByKind: result.nodesByKind,
      edgesByKind: result.edgesByKind,
      durationMs: { total: performance.now() - started },
    };
  } finally {
    store.close();
  }
}
