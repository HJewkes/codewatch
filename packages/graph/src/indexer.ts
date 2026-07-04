import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { parseFile, type ParsedFile } from "@codewatch/core";
import { openDatabase, GraphDatabase } from "./database.js";
import { TsMorphGraphExtractor } from "./extractors/ts-morph-extractor.js";
import {
  buildAliases,
  detectGitHead,
  detectGitToplevel,
  detectRenames,
  isInsideGitRepo,
} from "./git-renames.js";
import { annotateRoles } from "./roles.js";
import { walkSourceFiles } from "./file-walk.js";
import { pruneDanglingReferences } from "./barrel-resolve.js";
import { fileId } from "./extractors/ids.js";
import {
  assembleFragments,
  buildFingerprints,
  classifyForReuse,
  classifyParsed,
  loadReuseBasis,
  readSourceFiles,
} from "./incremental.js";
import { computeDeltaAffected } from "./reuse-delta.js";
import { buildIndexerMetrics } from "./index-metrics.js";
import type {
  GraphEdge,
  GraphFragment,
  GraphMetric,
  GraphNode,
  IdAlias,
} from "./types.js";

const INDEX_VERSION = "0.10.0"; // C-68: destructured dynamic-import references edges; rejects pre-0.10.0 reuse basis (which lacks them)
const TS_LANGUAGES = ["typescript"] as const;

export interface GraphIndexOptions {
  /**
   * Single root to index. Provide either this or `rootDirs`.
   * Equivalent to `rootDirs: [rootDir]`.
   */
  rootDir?: string;
  /**
   * Multiple roots to index in a single snapshot. Walk happens in each
   * subtree; node ids are still rooted at the git toplevel so importers
   * across subtrees see the same id space.
   */
  rootDirs?: string[];
  dbPath?: string;
  ref?: string;
  commitHash?: string;
  tsConfigPath?: string;
  detectRenames?: boolean;
  computeMetrics?: boolean;
  computeChurn?: boolean;
  churnWindowDays?: number;
  /** Churn windows to store so the dashboard switcher can resolve each (default
   * 30/90/180; the primary `churnWindowDays` is always included). */
  churnWindows?: number[];
  /**
   * Reuse the prior snapshot for byte-identical files: skip their tree-sitter
   * parse + ts-morph extract and carry their nodes/edges/source-metrics
   * forward. Survives a file-membership delta (C-20) — only files whose imports
   * the delta re-resolves re-extract (see `computeDeltaAffected`). Fingerprints
   * are written on every run regardless, so the next run has a basis to diff
   * against.
   *
   * Defaults to `true` — set `false` to force a full index. The reuse path is
   * provably equivalent to a full index, so the only reason to disable it is to
   * rebuild from scratch.
   */
  incremental?: boolean;
}

export interface GraphIndexDurations {
  walk: number;
  read: number;
  parse: number;
  extract: number;
  metrics: number;
  persist: number;
  total: number;
}

export interface GraphIndexResult {
  dbPath: string;
  snapshotId: number;
  files: number;
  nodes: number;
  edges: number;
  aliases: number;
  metrics: number;
  /** Files whose parse + extract were skipped by reusing the prior snapshot. */
  reusedFiles: number;
  /** Files that were parsed + extracted this run (new, changed, or full index). */
  reparsedFiles: number;
  /** Parsed files whose ts-morph extract was skipped as COSMETIC (C-18); a
   * subset of reparsedFiles — still tree-sitter parsed for spans + metrics. */
  cosmeticFiles: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  durationMs: GraphIndexDurations;
}

interface ExtractAccumulator {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

function canonicalizePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function normalizeRootDirs(options: GraphIndexOptions): string[] {
  const fromPlural = options.rootDirs ?? [];
  const fromSingle = options.rootDir ? [options.rootDir] : [];
  const resolved = [...fromSingle, ...fromPlural].map((p) => path.resolve(p));
  if (resolved.length === 0) {
    throw new Error("runGraphIndex requires either rootDir or rootDirs");
  }
  // dedupe while preserving order
  return [...new Set(resolved)];
}

function edgeKey(edge: GraphEdge): string {
  // JSON-encode so ids containing the separator can't collide (paths may hold
  // spaces). Mirrors the (snapshot_id, src_id, dst_id, kind) edge primary key.
  return JSON.stringify([edge.srcId, edge.dstId, edge.kind]);
}

function mergeFragments(fragments: readonly GraphFragment[]): ExtractAccumulator {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const fragment of fragments) {
    for (const node of fragment.nodes) {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    }
    for (const edge of fragment.edges) {
      const key = edgeKey(edge);
      if (!edges.has(key)) edges.set(key, edge);
    }
  }
  return { nodes, edges };
}

function countByKind<T extends { kind: string }>(
  items: Iterable<T>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item.kind] = (out[item.kind] ?? 0) + 1;
  return out;
}

async function ensureDbDir(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
}

function persist(
  db: GraphDatabase,
  ref: string,
  commitHash: string | undefined,
  accumulator: ExtractAccumulator,
  aliases: readonly IdAlias[],
  metrics: readonly GraphMetric[],
): number {
  const snapshotId = db.createSnapshot({
    ref,
    commitHash,
    indexVersion: INDEX_VERSION,
  });
  db.insertNodes(snapshotId, [...accumulator.nodes.values()]);
  db.insertEdges(snapshotId, [...accumulator.edges.values()]);
  if (aliases.length > 0) db.insertAliases(snapshotId, aliases);
  if (metrics.length > 0) db.insertMetrics(snapshotId, metrics);
  return snapshotId;
}

function findPriorCommit(db: GraphDatabase): string | null {
  const snap = db.listSnapshots({ limit: 50 }).find((s) => s.commitHash);
  return snap?.commitHash ?? null;
}

function resolveAliases(
  rootDir: string,
  idRoot: string,
  options: GraphIndexOptions,
  db: GraphDatabase,
  currentCommit: string | undefined,
): IdAlias[] {
  if (options.detectRenames === false) return [];
  if (!isInsideGitRepo(rootDir)) return [];
  const priorCommit = findPriorCommit(db);
  if (!priorCommit) return [];
  const target = currentCommit ?? detectGitHead(rootDir) ?? undefined;
  if (target === priorCommit) return [];
  const pairs = detectRenames({
    repoRoot: rootDir,
    fromCommit: priorCommit,
    toCommit: target,
  });
  return buildAliases(idRoot, pairs);
}

export async function runGraphIndex(
  options: GraphIndexOptions,
): Promise<GraphIndexResult> {
  const rawRoots = normalizeRootDirs(options);
  // detectGitToplevel uses any root as the seed — they should all live under
  // the same git repo. We use the first one.
  const gitToplevel = detectGitToplevel(rawRoots[0]!);
  // In a git repo, canonicalize each root so it shares a form with `git
  // rev-parse --show-toplevel` (which resolves symlinks like /var → /private/var
  // on macOS). Outside git, leave them alone so tsconfig path resolution and
  // anything else expecting the user's literal input still work.
  const rootDirs =
    gitToplevel !== null ? rawRoots.map(canonicalizePath) : rawRoots;
  // primaryRoot is used for derived paths (git churn etc.) that historically
  // operated on a single root. Mostly only the first root matters for these,
  // and it's an ancestor of git toplevel or equal to it.
  const rootDir = rootDirs[0]!;
  const idRoot = gitToplevel ?? rootDir;
  // Default the db to the git toplevel (idRoot), not the indexed subdir. Node
  // ids are already rooted at idRoot (PR #10), so a db keyed off the subdir
  // would silently diverge from `graph index .` — e.g. `graph index packages`
  // writing to packages/.codewatch/graph.db (C-22). Outside git, idRoot === rootDir.
  const dbPath = options.dbPath
    ? path.resolve(options.dbPath)
    : path.join(idRoot, ".codewatch", "graph.db");
  const ref = options.ref ?? "wd";

  const tStart = performance.now();
  const tWalk0 = performance.now();
  const filePaths = await walkSourceFiles(rootDirs, TS_LANGUAGES);
  const tWalk = performance.now() - tWalk0;

  const tRead0 = performance.now();
  const readFiles = await readSourceFiles(filePaths);
  const tRead = performance.now() - tRead0;

  await ensureDbDir(dbPath);
  const db = openDatabase(dbPath);
  try {
    const currentFileIds = new Set(
      readFiles.map((rf) => fileId(idRoot, rf.filePath)),
    );
    const reuse =
      options.incremental !== false ? loadReuseBasis(db, INDEX_VERSION) : null;
    // C-20: on a membership delta, reuse every unchanged file except those whose
    // imports the delta re-resolves; empty set when membership is unchanged.
    const affected = reuse ? computeDeltaAffected(reuse, currentFileIds) : new Set<string>();
    const { toParse, reusedFileIds } = classifyForReuse(
      readFiles,
      idRoot,
      reuse,
      affected,
    );

    const tParse0 = performance.now();
    const parsedByPath = new Map<string, ParsedFile>();
    for (const rf of toParse) {
      parsedByPath.set(
        rf.filePath,
        await parseFile(rf.content, rf.filePath, rf.language),
      );
    }
    const tParse = performance.now() - tParse0;

    const extractor = new TsMorphGraphExtractor({
      repoRoot: idRoot,
      tsConfigPath: options.tsConfigPath,
    });
    // C-18: split parsed files into COSMETIC (structure unchanged → reuse edges,
    // skip ts-morph extract) vs STRUCTURAL, and collect signatures to persist.
    const classified = classifyParsed(
      parsedByPath,
      idRoot,
      reuse,
      reusedFileIds,
      affected,
    );
    const tExtract0 = performance.now();
    const fragments = assembleFragments({
      readFiles,
      idRoot,
      parsedByPath,
      reuse,
      cosmeticFileIds: classified.cosmeticFileIds,
      extractor,
    });
    const accumulator = mergeFragments(fragments);
    const shebangIds = new Set(
      readFiles
        .filter((rf) => rf.content.startsWith("#!"))
        .map((rf) => fileId(idRoot, rf.filePath)),
    );
    const annotated = annotateRoles([...accumulator.nodes.values()], {
      shebangIds,
    });
    accumulator.nodes = new Map(annotated.map((n) => [n.id, n]));
    pruneDanglingReferences(accumulator.nodes, accumulator.edges);
    const tExtract = performance.now() - tExtract0;

    const tMetrics0 = performance.now();
    const reusedSourceMetrics = reuse
      ? reusedFileIds.flatMap((id) => reuse.sourceMetricsByFile.get(id) ?? [])
      : [];
    const metrics: GraphMetric[] =
      options.computeMetrics === false
        ? []
        : buildIndexerMetrics({
            nodes: accumulator.nodes,
            edges: accumulator.edges,
            parsedFiles: [...parsedByPath.values()],
            reusedSourceMetrics,
            idRoot,
            computeChurn: options.computeChurn !== false,
            churnWindowDays: options.churnWindowDays,
            churnWindows: options.churnWindows,
          });
    const tMetrics = performance.now() - tMetrics0;

    const tPersist0 = performance.now();
    const aliases = resolveAliases(
      rootDir,
      idRoot,
      options,
      db,
      options.commitHash,
    );
    const commitHash =
      options.commitHash ?? detectGitHead(rootDir) ?? undefined;
    const snapshotId = persist(db, ref, commitHash, accumulator, aliases, metrics);
    db.insertFingerprints(
      snapshotId,
      buildFingerprints(readFiles, idRoot, classified.structuralByFileId),
    );
    const tPersist = performance.now() - tPersist0;

    return {
      dbPath,
      snapshotId,
      files: readFiles.length,
      nodes: accumulator.nodes.size,
      edges: accumulator.edges.size,
      aliases: aliases.length,
      metrics: metrics.length,
      reusedFiles: reusedFileIds.length,
      reparsedFiles: toParse.length,
      cosmeticFiles: classified.cosmeticFileIds.size,
      nodesByKind: countByKind(accumulator.nodes.values()),
      edgesByKind: countByKind(accumulator.edges.values()),
      durationMs: {
        walk: tWalk,
        read: tRead,
        parse: tParse,
        extract: tExtract,
        metrics: tMetrics,
        persist: tPersist,
        total: performance.now() - tStart,
      },
    };
  } finally {
    db.close();
  }
}
