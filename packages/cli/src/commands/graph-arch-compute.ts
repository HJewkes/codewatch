import {
  compilePatterns,
  matchesAny,
  type GraphEdge,
  type GraphNode,
  type SnapshotRow,
} from "@codewatch/graph";
import {
  bucketFilesByPackage,
  type PackageRoot,
} from "./graph-wiki-packages.js";
import type { ArchEdge, ArchPackage, ArchResult } from "./graph-arch.js";

export const EXTERNAL_BUCKET = "(external)";

export interface ComputeArchInput {
  snapshot: SnapshotRow;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  packages: readonly PackageRoot[];
  exclude?: string[];
  excludeRole?: string[];
  includeExternal?: boolean;
  minEdges?: number;
}

export function computeArch(input: ComputeArchInput): ArchResult {
  const fileIds = filteredFileIds(input.nodes, input);
  const fileByPackage = bucketFilesByPackage(fileIds, input.packages);
  const pkgByFile = invertBuckets(fileByPackage);
  const externalIds = new Set(
    input.nodes.filter((n) => n.kind === "external").map((n) => n.id),
  );
  const counts = aggregateEdges(
    input.edges,
    pkgByFile,
    externalIds,
    Boolean(input.includeExternal),
  );
  const minEdges = Math.max(1, input.minEdges ?? 1);
  return {
    snapshot: input.snapshot,
    packages: activePackages(
      input.packages,
      fileByPackage,
      Boolean(input.includeExternal),
      counts,
    ),
    edges: toSortedEdges(counts, minEdges),
    includesExternal: Boolean(input.includeExternal),
  };
}

export function filteredFileIds(
  nodes: readonly GraphNode[],
  options: { exclude?: string[]; excludeRole?: string[] },
): string[] {
  const excluders = compilePatterns(options.exclude);
  const excludedRoles = new Set(options.excludeRole ?? []);
  return nodes
    .filter((n) => n.kind === "file")
    .filter((n) => !excludedRoles.has(n.role ?? ""))
    .filter((n) => !matchesAny(n.id, excluders))
    .map((n) => n.id);
}

export function invertBuckets(
  fileByPackage: ReadonlyMap<string, ReadonlyArray<string>>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [pkgId, files] of fileByPackage) {
    if (pkgId === "") continue;
    for (const f of files) out.set(f, pkgId);
  }
  return out;
}

function aggregateEdges(
  edges: ReadonlyArray<{ srcId: string; dstId: string }>,
  pkgByFile: ReadonlyMap<string, string>,
  externalIds: ReadonlySet<string>,
  includeExternal: boolean,
): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (const e of edges) {
    const fromPkg = pkgByFile.get(e.srcId);
    if (!fromPkg) continue;
    const toPkg = resolveDestinationBucket(
      e.dstId,
      pkgByFile,
      externalIds,
      includeExternal,
    );
    if (!toPkg || toPkg === fromPkg) continue;
    bump(counts, fromPkg, toPkg);
  }
  return counts;
}

function resolveDestinationBucket(
  dstId: string,
  pkgByFile: ReadonlyMap<string, string>,
  externalIds: ReadonlySet<string>,
  includeExternal: boolean,
): string | null {
  const pkg = pkgByFile.get(dstId);
  if (pkg !== undefined) return pkg;
  if (externalIds.has(dstId) && includeExternal) return EXTERNAL_BUCKET;
  return null;
}

function bump(
  counts: Map<string, Map<string, number>>,
  from: string,
  to: string,
): void {
  let row = counts.get(from);
  if (!row) {
    row = new Map();
    counts.set(from, row);
  }
  row.set(to, (row.get(to) ?? 0) + 1);
}

function toSortedEdges(
  counts: ReadonlyMap<string, ReadonlyMap<string, number>>,
  minEdges: number,
): ArchEdge[] {
  const out: ArchEdge[] = [];
  for (const [from, row] of counts) {
    for (const [to, count] of row) {
      if (count < minEdges) continue;
      out.push({ from, to, count });
    }
  }
  out.sort(compareArchEdges);
  return out;
}

function compareArchEdges(a: ArchEdge, b: ArchEdge): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  return a.to < b.to ? -1 : 1;
}

function activePackages(
  all: readonly PackageRoot[],
  fileByPackage: ReadonlyMap<string, ReadonlyArray<string>>,
  includeExternal: boolean,
  counts: ReadonlyMap<string, ReadonlyMap<string, number>>,
): ArchPackage[] {
  const referenced = packagesReferencedByEdges(counts);
  const out: ArchPackage[] = [];
  for (const p of all) {
    const files = fileByPackage.get(p.id)?.length ?? 0;
    if (files === 0 && !referenced.has(p.id)) continue;
    out.push({ id: p.id, name: p.name, files });
  }
  if (includeExternal && referenced.has(EXTERNAL_BUCKET)) {
    out.push({ id: EXTERNAL_BUCKET, name: EXTERNAL_BUCKET, files: 0 });
  }
  return out;
}

function packagesReferencedByEdges(
  counts: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Set<string> {
  const referenced = new Set<string>();
  for (const [from, row] of counts) {
    referenced.add(from);
    for (const to of row.keys()) referenced.add(to);
  }
  return referenced;
}
