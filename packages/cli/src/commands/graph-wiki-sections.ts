import { invertBuckets } from "@codewatch/graph";
import type {
  GraphEdge,
  GraphNode,
  PageRankRow,
  SnapshotRow,
} from "@codewatch/graph";
import {
  topBusFactorRisks,
  topCouplingClusters,
  topHotspots,
  type ReportContext,
} from "./graph-report-sections.js";
import type { ArchResult } from "./graph-arch.js";
import type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  HotspotRow,
} from "./graph-report-types.js";
import type { PackageRoot } from "./graph-wiki-packages.js";

export interface PackageSummary {
  files: number;
  totalChurn: number;
  distinctAuthors: number;
  hotspots: number;
  silos: number;
}

export interface CrossPkgDepRow {
  /** Other package id; "(external)" for npm/node imports. */
  pkg: string;
  count: number;
  /** Up to 3 example dependency edges (src or dst depending on direction). */
  examples: string[];
}

export interface PackageWiki {
  pkg: PackageRoot;
  summary: PackageSummary;
  hotspots: HotspotRow[];
  silos: BusFactorRow[];
  coupling: CouplingRow[];
  inbound: CrossPkgDepRow[];
  outbound: CrossPkgDepRow[];
  central: CentralRow[];
}

export interface WikiResult {
  snapshot: SnapshotRow;
  windowDays: number;
  packages: PackageWiki[];
  arch: ArchResult;
}

export interface BuildWikiInput {
  globalCtx: ReportContext;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  pageRank: readonly PageRankRow[];
  packages: readonly PackageRoot[];
  fileByPackage: ReadonlyMap<string, ReadonlyArray<string>>;
  repoRoot: string;
  windowDays: number;
  limit: number;
}

const EXTERNAL_PKG = "(external)";

export function buildWikiPackages(input: BuildWikiInput): PackageWiki[] {
  const pkgByFile = invertBuckets(input.fileByPackage);
  return input.packages
    .map((pkg) => buildOne(pkg, pkgByFile, input))
    .filter((w) => w.summary.files > 0);
}

function buildOne(
  pkg: PackageRoot,
  pkgByFile: ReadonlyMap<string, string>,
  input: BuildWikiInput,
): PackageWiki {
  const fileIds = new Set(input.fileByPackage.get(pkg.id) ?? []);
  const subCtx = filterContext(input.globalCtx, fileIds);
  const limit = input.limit;
  const hotspots = topHotspots(subCtx, limit);
  const silos = topBusFactorRisks(subCtx, limit);
  const coupling = topCouplingClusters(
    subCtx,
    input.repoRoot,
    input.windowDays,
    limit,
  );
  const { inbound, outbound } = crossPackageDeps(
    pkg.id,
    fileIds,
    input.edges,
    pkgByFile,
    limit,
  );
  return {
    pkg,
    summary: summarize(fileIds, subCtx, hotspots.length, silos.length),
    hotspots,
    silos,
    coupling,
    inbound,
    outbound,
    central: topCentralFromGlobal(input.pageRank, fileIds, limit),
  };
}

function filterContext(
  ctx: ReportContext,
  fileIds: ReadonlySet<string>,
): ReportContext {
  return {
    ...ctx,
    nodes: ctx.nodes.filter((n) => fileIds.has(n.id)),
  };
}

function topCentralFromGlobal(
  pageRank: readonly PageRankRow[],
  fileIds: ReadonlySet<string>,
  limit: number,
): CentralRow[] {
  const rows: CentralRow[] = [];
  for (const r of pageRank) {
    if (!fileIds.has(r.nodeId)) continue;
    rows.push({ nodeId: r.nodeId, score: r.score });
    if (rows.length >= limit) break;
  }
  return rows;
}

function summarize(
  fileIds: ReadonlySet<string>,
  ctx: ReportContext,
  hotspotCount: number,
  siloCount: number,
): PackageSummary {
  const churnName = `churn_${ctx.windowDays}d`;
  const authorsName = `churn_${ctx.windowDays}d_authors`;
  const churnByFile = ctx.metricsByName.get(churnName);
  const authorsByFile = ctx.metricsByName.get(authorsName);
  let totalChurn = 0;
  let distinctAuthors = 0;
  for (const id of fileIds) {
    totalChurn += churnByFile?.get(id) ?? 0;
    distinctAuthors = Math.max(distinctAuthors, authorsByFile?.get(id) ?? 0);
  }
  return {
    files: fileIds.size,
    totalChurn,
    distinctAuthors,
    hotspots: hotspotCount,
    silos: siloCount,
  };
}

function crossPackageDeps(
  selfId: string,
  selfFiles: ReadonlySet<string>,
  edges: readonly GraphEdge[],
  pkgByFile: ReadonlyMap<string, string>,
  limit: number,
): { inbound: CrossPkgDepRow[]; outbound: CrossPkgDepRow[] } {
  const inbound = new Map<string, { count: number; examples: string[] }>();
  const outbound = new Map<string, { count: number; examples: string[] }>();
  for (const e of edges) {
    const srcInSelf = selfFiles.has(e.srcId);
    const dstInSelf = selfFiles.has(e.dstId);
    if (srcInSelf === dstInSelf) continue;
    if (srcInSelf) {
      const otherPkg = pkgByFile.get(e.dstId) ?? EXTERNAL_PKG;
      if (otherPkg === selfId) continue;
      record(outbound, otherPkg, `${e.srcId} → ${e.dstId}`);
    } else {
      const otherPkg = pkgByFile.get(e.srcId) ?? EXTERNAL_PKG;
      if (otherPkg === selfId) continue;
      record(inbound, otherPkg, `${e.srcId} → ${e.dstId}`);
    }
  }
  return {
    inbound: toRows(inbound, limit),
    outbound: toRows(outbound, limit),
  };
}

function record(
  m: Map<string, { count: number; examples: string[] }>,
  pkg: string,
  example: string,
): void {
  let bucket = m.get(pkg);
  if (!bucket) {
    bucket = { count: 0, examples: [] };
    m.set(pkg, bucket);
  }
  bucket.count += 1;
  if (bucket.examples.length < 3) bucket.examples.push(example);
}

function toRows(
  m: ReadonlyMap<string, { count: number; examples: string[] }>,
  limit: number,
): CrossPkgDepRow[] {
  return [...m.entries()]
    .map(([pkg, v]) => ({ pkg, count: v.count, examples: v.examples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
