import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  detectGitToplevel,
  gitTreeSource,
  indexPaths,
  openCodeGraph,
  type IndexOptions,
  type IndexSource,
} from "@titan-design/code-graph";
import { defaultGraphDbPath, moveLegacyGraphDbAside } from "../utils/graph-store.js";

export interface GraphIndexOptions extends Omit<IndexOptions, "paths" | "tsConfig" | "source"> {
  /** Index this git rev's tree instead of the working tree; also the default snapshot label. */
  rev?: string;
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
  /** Churn and ownership need git history: "unavailable" outside a git tree, "skipped" with --no-churn. */
  churn: "computed" | "skipped" | "unavailable";
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
  return defaultGraphDbPath(firstRoot);
}

/** Under --rev the indexed dirs may be gone from disk, so the git toplevel comes from the cwd. */
function revToplevel(): string {
  const toplevel = detectGitToplevel(process.cwd());
  if (toplevel === null) throw new Error("graph index --rev must run inside a git repository");
  return toplevel;
}

function toIndexOptions(
  options: GraphIndexOptions,
  paths: string[],
  source: IndexSource | undefined,
): IndexOptions {
  return {
    paths,
    source,
    ref: options.ref ?? options.rev,
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

function churnStatus(options: GraphIndexOptions, root: string): GraphIndexResult["churn"] {
  if (detectGitToplevel(root) === null) return "unavailable";
  return options.computeChurn === false ? "skipped" : "computed";
}

export async function runGraphIndex(options: GraphIndexOptions): Promise<GraphIndexResult> {
  const started = performance.now();
  const rootDirs = normalizeRootDirs(options);
  const toplevel = options.rev === undefined ? undefined : revToplevel();
  const source = toplevel === undefined ? undefined : gitTreeSource(toplevel, options.rev!);
  const churn = churnStatus(options, toplevel ?? rootDirs[0]!);
  const indexOptions = { ...toIndexOptions(options, rootDirs, source), computeChurn: churn === "computed" };
  const dbPath = resolveIndexDbPath(options.dbPath, toplevel ?? rootDirs[0]!);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const aside = moveLegacyGraphDbAside(dbPath);
  if (aside) {
    (options.onNotice ?? console.error)(
      `codewatch: ${dbPath} predates codewatch 0.2; renamed it to ${aside} and started a fresh index`,
    );
  }
  const store = openCodeGraph(dbPath);
  try {
    const result = await indexPaths(store, indexOptions);
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
      churn,
      durationMs: { total: performance.now() - started },
    };
  } finally {
    store.close();
  }
}
