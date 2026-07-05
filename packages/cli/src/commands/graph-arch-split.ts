import * as path from "node:path";
import {
  computeChangeCoupling,
  computePartitionQuality,
  invertBuckets,
  loadChurnEntries,
  resolveBarrelEdges,
  type CoEditPair,
  type GraphEdge,
  type GraphNode,
  type SnapshotRow,
} from "@codewatch/graph";
import {
  bucketFilesByPackage,
  type PackageRoot,
} from "./graph-wiki-packages.js";
import { filteredFileIds } from "./graph-arch-compute.js";
import { detectCommunities } from "./graph-arch-community.js";
import type { ArchResult } from "./graph-arch.js";

/** Only packages with at least this many files are worth clustering. */
export const DEFAULT_SPLIT_MIN_FILES = 15;

/**
 * File-pair co-edit counts from git history, restricted to indexed files.
 * Returns null when the repo has no readable git history (the diagnostic then
 * omits the co-edit read-out). minCount=1 keeps every co-edit so the
 * within/cross density is measured over the full signal.
 */
export function loadCoEditPairs(
  repoRoot: string,
  nodes: readonly GraphNode[],
): CoEditPair[] | null {
  const knownFileIds = new Set(
    nodes.filter((n) => n.kind === "file").map((n) => n.id),
  );
  const entries = loadChurnEntries({ repoRoot, knownFileIds });
  if (entries === null) return null;
  return computeChangeCoupling(entries, { minCount: 1, knownFileIds }).pairs;
}

export interface ArchSplitInput {
  snapshot: SnapshotRow;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  packages: readonly PackageRoot[];
  exclude?: string[];
  excludeRole?: string[];
  /** File-pair co-edit counts (git history); null when history is unavailable. */
  coEditPairs?: readonly CoEditPair[] | null;
  minFiles?: number;
}

/** An internal edge crossing two clusters — the actionable seam. */
export interface BridgeEdge {
  from: string;
  to: string;
  fromCluster: string;
  toCluster: string;
  count: number;
}

export interface ClusterEvidence {
  id: string;
  files: string[];
  /** Other packages this cluster's files import from (sorted, deduped). */
  externalPackages: string[];
}

export interface CoEditDensity {
  /** Mean co-edit count per within-cluster file pair. */
  within: number;
  /** Mean co-edit count per cross-cluster file pair. */
  cross: number;
  /** cross / within — below 1 means co-changes concentrate inside clusters. */
  ratio: number | null;
}

/** Structural evidence for one package. Deliberately carries NO verdict field. */
export interface PackageSplitEvidence {
  pkgId: string;
  name: string;
  fileCount: number;
  clusters: ClusterEvidence[];
  subModularityQ: number;
  bridges: BridgeEdge[];
  /** Min pairwise cosine of external coupling between clusters with external deps; null if <2 qualify. */
  minExternalCosine: number | null;
  /** Weighted mean cluster directory purity (1 = clusters already ARE directories). */
  directoryAlignment: number;
  coEdit?: CoEditDensity;
}

export interface ArchSplitResult {
  snapshot: SnapshotRow;
  minFiles: number;
  coEditAvailable: boolean;
  packages: PackageSplitEvidence[];
}

interface AnalyzeCtx {
  input: ArchSplitInput;
  /** Barrel-resolved file→file edges, self-loops removed. */
  edges: readonly GraphEdge[];
  pkgByFile: ReadonlyMap<string, string>;
}

/** Wrap the split evidence in the shared ArchResult envelope for the command layer. */
export function runArchSplit(input: ArchSplitInput): ArchResult {
  return {
    snapshot: input.snapshot,
    packages: [],
    edges: [],
    includesExternal: false,
    split: computeArchSplit(input),
  };
}

export function computeArchSplit(input: ArchSplitInput): ArchSplitResult {
  const minFiles = input.minFiles ?? DEFAULT_SPLIT_MIN_FILES;
  const fileIds = filteredFileIds(input.nodes, input);
  const fileByPackage = bucketFilesByPackage(fileIds, input.packages);
  const ctx: AnalyzeCtx = {
    input,
    edges: interFileEdges(input.nodes, input.edges, new Set(fileIds)),
    pkgByFile: invertBuckets(fileByPackage),
  };
  const packages = input.packages
    .filter((p) => (fileByPackage.get(p.id)?.length ?? 0) >= minFiles)
    .map((p) => analyzePackage(p, fileByPackage.get(p.id)!, ctx))
    .sort((a, b) => (a.pkgId < b.pkgId ? -1 : a.pkgId > b.pkgId ? 1 : 0));
  return {
    snapshot: input.snapshot,
    minFiles,
    coEditAvailable: input.coEditPairs != null,
    packages,
  };
}

/** Barrel-resolved edges between two distinct indexed files. */
function interFileEdges(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  fileSet: ReadonlySet<string>,
): GraphEdge[] {
  return resolveBarrelEdges(nodes, edges).filter(
    (e) => e.srcId !== e.dstId && fileSet.has(e.srcId) && fileSet.has(e.dstId),
  );
}

function analyzePackage(
  pkg: PackageRoot,
  files: readonly string[],
  ctx: AnalyzeCtx,
): PackageSplitEvidence {
  const pkgFiles = new Set(files);
  const internal = ctx.edges.filter(
    (e) => pkgFiles.has(e.srcId) && pkgFiles.has(e.dstId),
  );
  const communities = detectCommunities(files, internal);
  const communityOf = labelByFile(communities);
  const vectors = externalVectors(communityOf, ctx.edges, ctx.pkgByFile, pkg.id);
  return {
    pkgId: pkg.id,
    name: pkg.name,
    fileCount: files.length,
    clusters: buildClusters(communities, vectors),
    subModularityQ: subQ(ctx.input, internal, communities),
    bridges: extractBridges(internal, communityOf),
    minExternalCosine: minCosine(vectors),
    directoryAlignment: directoryAlignment(communities),
    coEdit: coEditDensity(ctx.input.coEditPairs, communityOf, pkgFiles),
  };
}

function labelByFile(
  communities: ReadonlyMap<string, string[]>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, files] of communities) for (const f of files) out.set(f, id);
  return out;
}

/** Sub-modularity Q of the community partition over the package's internal edges. */
function subQ(
  input: ArchSplitInput,
  internal: readonly GraphEdge[],
  communities: ReadonlyMap<string, string[]>,
): number {
  return computePartitionQuality({
    packages: [...communities.keys()].map((id) => ({ id })),
    fileByPackage: communities,
    nodes: input.nodes,
    edges: internal,
  }).modularityQ;
}

/** Per community, the multiset of OTHER packages its files import from. */
function externalVectors(
  communityOf: ReadonlyMap<string, string>,
  edges: readonly GraphEdge[],
  pkgByFile: ReadonlyMap<string, string>,
  ownPkg: string,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const c of new Set(communityOf.values())) out.set(c, new Map());
  for (const e of edges) {
    const c = communityOf.get(e.srcId);
    const dstPkg = pkgByFile.get(e.dstId);
    if (c === undefined || dstPkg === undefined || dstPkg === ownPkg) continue;
    const vec = out.get(c)!;
    vec.set(dstPkg, (vec.get(dstPkg) ?? 0) + 1);
  }
  return out;
}

function buildClusters(
  communities: ReadonlyMap<string, string[]>,
  vectors: ReadonlyMap<string, ReadonlyMap<string, number>>,
): ClusterEvidence[] {
  const out: ClusterEvidence[] = [];
  for (const [id, files] of communities) {
    out.push({
      id,
      files: [...files].sort(),
      externalPackages: [...(vectors.get(id)?.keys() ?? [])].sort(),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Internal edges whose endpoints fall in different communities, aggregated by pair. */
function extractBridges(
  internal: readonly GraphEdge[],
  communityOf: ReadonlyMap<string, string>,
): BridgeEdge[] {
  const counts = new Map<string, BridgeEdge>();
  for (const e of internal) {
    const fromCluster = communityOf.get(e.srcId)!;
    const toCluster = communityOf.get(e.dstId)!;
    if (fromCluster === toCluster) continue;
    const key = JSON.stringify([e.srcId, e.dstId]);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { from: e.srcId, to: e.dstId, fromCluster, toCluster, count: 1 });
  }
  return [...counts.values()].sort(compareBridges);
}

function compareBridges(a: BridgeEdge, b: BridgeEdge): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  return a.to < b.to ? -1 : 1;
}

/**
 * Min pairwise cosine of external-coupling vectors, over clusters that HAVE
 * external deps. A cluster with no external deps has cosine 0 against
 * everything — that is an artifact, not a seam — so it is excluded here.
 */
function minCosine(
  vectors: ReadonlyMap<string, ReadonlyMap<string, number>>,
): number | null {
  const withDeps = [...vectors.values()].filter((v) => v.size > 0);
  if (withDeps.length < 2) return null;
  let min = 1;
  for (let i = 0; i < withDeps.length; i += 1) {
    for (let j = i + 1; j < withDeps.length; j += 1) {
      min = Math.min(min, cosine(withDeps[i], withDeps[j]));
    }
  }
  return min;
}

function cosine(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  let dot = 0;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot / denom;
}

function norm(v: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const x of v.values()) sum += x * x;
  return Math.sqrt(sum);
}

/**
 * Weighted mean cluster purity against the directory partition: for each
 * cluster, the share of its files sitting in the single most common directory.
 * Near 1 means communities merely re-derive the directory layout — already
 * organized, a classifier AGAINST splitting, not a reason to.
 */
function directoryAlignment(communities: ReadonlyMap<string, string[]>): number {
  let total = 0;
  let pure = 0;
  for (const files of communities.values()) {
    const byDir = new Map<string, number>();
    for (const f of files) {
      const dir = path.posix.dirname(f);
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    }
    pure += Math.max(...byDir.values());
    total += files.length;
  }
  return total === 0 ? 0 : pure / total;
}

function coEditDensity(
  pairs: readonly CoEditPair[] | null | undefined,
  communityOf: ReadonlyMap<string, string>,
  pkgFiles: ReadonlySet<string>,
): CoEditDensity | undefined {
  if (pairs == null) return undefined;
  let within = 0;
  let cross = 0;
  for (const p of pairs) {
    if (!pkgFiles.has(p.fileA) || !pkgFiles.has(p.fileB)) continue;
    if (communityOf.get(p.fileA) === communityOf.get(p.fileB)) within += p.count;
    else cross += p.count;
  }
  const { withinPairs, crossPairs } = possiblePairs(communityOf, pkgFiles);
  const withinDensity = withinPairs === 0 ? 0 : within / withinPairs;
  const crossDensity = crossPairs === 0 ? 0 : cross / crossPairs;
  return {
    within: withinDensity,
    cross: crossDensity,
    ratio: withinDensity === 0 ? null : crossDensity / withinDensity,
  };
}

/** Count of possible unordered file pairs within vs across clusters. */
function possiblePairs(
  communityOf: ReadonlyMap<string, string>,
  pkgFiles: ReadonlySet<string>,
): { withinPairs: number; crossPairs: number } {
  const sizes = new Map<string, number>();
  for (const f of pkgFiles) {
    const c = communityOf.get(f)!;
    sizes.set(c, (sizes.get(c) ?? 0) + 1);
  }
  let withinPairs = 0;
  for (const n of sizes.values()) withinPairs += (n * (n - 1)) / 2;
  const total = (pkgFiles.size * (pkgFiles.size - 1)) / 2;
  return { withinPairs, crossPairs: total - withinPairs };
}
