import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { getLanguageFromPath, type ParsedFile } from "@codewatch/core";
import type { GraphDatabase } from "./database.js";
import {
  buildFileModuleNodes,
  TsMorphGraphExtractor,
} from "./extractors/ts-morph-extractor.js";
import { fileId } from "./extractors/ids.js";
import { SOURCE_METRIC_NAMES } from "./source-metrics.js";
import type {
  FileFingerprint,
  GraphEdge,
  GraphFragment,
  GraphMetric,
  GraphNode,
} from "./types.js";

/** SHA-256 of file content. The fingerprint that gates per-file reuse. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface ReadFile {
  filePath: string;
  language: "typescript";
  content: string;
  hash: string;
}

/** Read + hash every TypeScript file. Cheap I/O; the parse/extract it gates is not. */
export async function readSourceFiles(
  filePaths: readonly string[],
): Promise<ReadFile[]> {
  const out: ReadFile[] = [];
  for (const filePath of filePaths) {
    const language = getLanguageFromPath(filePath);
    if (language !== "typescript") continue;
    const content = await fs.readFile(filePath, "utf-8");
    out.push({ filePath, language, content, hash: hashContent(content) });
  }
  return out;
}

/** Split files into those to (re)parse and those reusable from the prior snapshot. */
export function classifyForReuse(
  readFiles: readonly ReadFile[],
  idRoot: string,
  reuse: ReuseBasis | null,
): { toParse: ReadFile[]; reusedFileIds: string[] } {
  const toParse: ReadFile[] = [];
  const reusedFileIds: string[] = [];
  for (const rf of readFiles) {
    const id = fileId(idRoot, rf.filePath);
    if (reuse && reuse.fingerprints.get(id) === rf.hash) {
      reusedFileIds.push(id);
    } else {
      toParse.push(rf);
    }
  }
  return { toParse, reusedFileIds };
}

/**
 * Build fragments for all files in walk order — extracting freshly-parsed files
 * and reconstructing reused ones. Walk order is preserved so the merge dedup
 * resolves shared nodes identically to a full index.
 */
export function assembleFragments(input: {
  readFiles: readonly ReadFile[];
  idRoot: string;
  parsedByPath: Map<string, ParsedFile>;
  reuse: ReuseBasis | null;
  extractor: TsMorphGraphExtractor;
}): GraphFragment[] {
  const fragments: GraphFragment[] = [];
  for (const rf of input.readFiles) {
    const parsed = input.parsedByPath.get(rf.filePath);
    if (parsed) {
      fragments.push(...input.extractor.extract(parsed));
    } else if (input.reuse) {
      const id = fileId(input.idRoot, rf.filePath);
      fragments.push(
        reconstructFragment(input.idRoot, rf.filePath, id, input.reuse),
      );
    }
  }
  return fragments;
}

/** One content fingerprint per file, ready to persist for the next run to diff against. */
export function buildFingerprints(
  readFiles: readonly ReadFile[],
  idRoot: string,
): FileFingerprint[] {
  return readFiles.map((rf) => ({
    fileId: fileId(idRoot, rf.filePath),
    contentHash: rf.hash,
  }));
}

/**
 * Everything from a prior snapshot needed to rebuild an unchanged file's
 * contribution to the graph without re-parsing it: its content fingerprint,
 * the node table (to look up external-node names), outbound edges grouped by
 * source, and the source-content metrics (loc, complexity, lcom4, ...).
 */
export interface ReuseBasis {
  snapshotId: number;
  fingerprints: Map<string, string>;
  nodesById: Map<string, GraphNode>;
  edgesBySrc: Map<string, GraphEdge[]>;
  sourceMetricsByFile: Map<string, GraphMetric[]>;
  /** Symbol nodes grouped by their declaring file id, to carry forward for reused files (C-53). */
  symbolsByFile: Map<string, GraphNode[]>;
}

/**
 * Pick the most recent snapshot usable as a reuse basis: same index version and
 * carrying file fingerprints. Older snapshots predate the fingerprint table and
 * can't be diffed, so we return null and the caller does a full index.
 */
export function loadReuseBasis(
  db: GraphDatabase,
  indexVersion: string,
): ReuseBasis | null {
  for (const snap of db.listSnapshots({ limit: 50 })) {
    if (snap.indexVersion !== indexVersion) continue;
    const fingerprints = db.listFingerprints(snap.id);
    if (fingerprints.length === 0) continue;

    const nodesById = new Map<string, GraphNode>();
    const symbolsByFile = new Map<string, GraphNode[]>();
    // Opt into the symbol layer: reuse must carry symbol nodes and their inbound
    // reference edges forward for unchanged files (C-53).
    for (const n of db.listNodes(snap.id, { includeSymbols: true })) {
      nodesById.set(n.id, n);
      if (n.kind === "symbol" && n.parentId) {
        const bucket = symbolsByFile.get(n.parentId);
        if (bucket) bucket.push(n);
        else symbolsByFile.set(n.parentId, [n]);
      }
    }

    const edgesBySrc = new Map<string, GraphEdge[]>();
    for (const e of db.listEdges(snap.id, { includeReferences: true })) {
      const bucket = edgesBySrc.get(e.srcId);
      if (bucket) bucket.push(e);
      else edgesBySrc.set(e.srcId, [e]);
    }

    const sourceMetricsByFile = new Map<string, GraphMetric[]>();
    for (const m of db.listMetrics(snap.id)) {
      if (!SOURCE_METRIC_NAMES.has(m.name)) continue;
      // Per-symbol metrics (C-58) live on `<fileId>#<name>` nodes; bucket them
      // under their parent file so an unchanged file carries its symbol
      // complexity forward alongside its file-level source metrics.
      const node = nodesById.get(m.nodeId);
      const fileKey =
        node?.kind === "symbol" && node.parentId ? node.parentId : m.nodeId;
      const bucket = sourceMetricsByFile.get(fileKey);
      if (bucket) bucket.push(m);
      else sourceMetricsByFile.set(fileKey, [m]);
    }

    return {
      snapshotId: snap.id,
      fingerprints: new Map(fingerprints.map((f) => [f.fileId, f.contentHash])),
      nodesById,
      edgesBySrc,
      sourceMetricsByFile,
      symbolsByFile,
    };
  }
  return null;
}

/**
 * Reuse is sound only when file membership is unchanged. Import edges resolve
 * against the *global* file set, so a byte-identical file's edges can still
 * change if a file it references is added or removed. When membership differs
 * we fall back to a full index. Returns true iff the basis can be reused.
 */
export function membershipUnchanged(
  basis: ReuseBasis,
  currentFileIds: ReadonlySet<string>,
): boolean {
  if (basis.fingerprints.size !== currentFileIds.size) return false;
  for (const id of currentFileIds) {
    if (!basis.fingerprints.has(id)) return false;
  }
  return true;
}

/**
 * Rebuild an unchanged file's graph fragment from the prior snapshot. Produces
 * byte-for-byte the same nodes and edges the extractor would emit: file +
 * module nodes (path-derived), the symbol nodes it declares (content-derived,
 * so carried forward from the basis rather than rebuilt — C-53), the external
 * nodes its imports reference, and the outbound edges carried forward verbatim.
 */
export function reconstructFragment(
  repoRoot: string,
  absPath: string,
  fileId: string,
  basis: ReuseBasis,
): GraphFragment {
  const nodes = buildFileModuleNodes(repoRoot, absPath);
  nodes.push(...(basis.symbolsByFile.get(fileId) ?? []));
  const edges = basis.edgesBySrc.get(fileId) ?? [];
  const seenExternals = new Set<string>();
  for (const edge of edges) {
    const dst = basis.nodesById.get(edge.dstId);
    if (dst?.kind === "external" && !seenExternals.has(dst.id)) {
      seenExternals.add(dst.id);
      nodes.push({ id: dst.id, kind: "external", name: dst.name });
    }
  }
  return { nodes, edges };
}
