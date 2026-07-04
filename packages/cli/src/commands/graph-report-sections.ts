import {
  computeChangeCoupling,
  computePageRank,
  loadChurnEntries,
  matchesAny,
  type CoEditPair,
  type GraphEdge,
  type GraphMetric,
  type GraphNode,
} from "@codewatch/graph";
import type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  DeadModuleRow,
  HotspotRow,
  TestCoverageRow,
  UnusedExportRow,
} from "./graph-report-types.js";

const COMPLEXITY_METRICS = ["cognitive_max", "cyclomatic_max"] as const;

export interface ReportContext {
  nodes: readonly GraphNode[];
  nodeById: Map<string, GraphNode>;
  metricsByName: Map<string, Map<string, number>>;
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

export interface ReportContextInput {
  nodes: readonly GraphNode[];
  metrics: readonly GraphMetric[];
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

export function buildReportContext(input: ReportContextInput): ReportContext {
  const metricsByName = new Map<string, Map<string, number>>();
  for (const m of input.metrics) {
    if (m.value === null) continue;
    let bucket = metricsByName.get(m.name);
    if (!bucket) {
      bucket = new Map();
      metricsByName.set(m.name, bucket);
    }
    bucket.set(m.nodeId, m.value);
  }
  return {
    nodes: input.nodes,
    nodeById: new Map(input.nodes.map((n) => [n.id, n])),
    metricsByName,
    excluders: input.excluders,
    excludedRoles: input.excludedRoles,
    windowDays: input.windowDays,
  };
}

export function keepNode(ctx: ReportContext, nodeId: string): boolean {
  if (matchesAny(nodeId, ctx.excluders)) return false;
  const node = ctx.nodeById.get(nodeId);
  if (!node || node.kind !== "file") return false;
  if (node.role && ctx.excludedRoles.has(node.role)) return false;
  return true;
}

function lookupMetric(
  ctx: ReportContext,
  name: string,
  nodeId: string,
): number | undefined {
  return ctx.metricsByName.get(name)?.get(nodeId);
}

function pickComplexityMetric(ctx: ReportContext): string {
  for (const m of COMPLEXITY_METRICS) {
    if (ctx.metricsByName.has(m)) return m;
  }
  return "cyclomatic_max";
}

export function topHotspots(
  ctx: ReportContext,
  limit: number,
): HotspotRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const complexityName = pickComplexityMetric(ctx);
  const rows: HotspotRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const churn = lookupMetric(ctx, churnName, node.id) ?? 0;
    const complexity = lookupMetric(ctx, complexityName, node.id) ?? 0;
    if (churn === 0 || complexity === 0) continue;
    const recency = lookupMetric(ctx, `recency_${ctx.windowDays}d`, node.id) ?? 1;
    rows.push({ nodeId: node.id, churn, complexity, recency, score: Math.round(churn * complexity * recency) });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

export function hotspotScoreOf(ctx: ReportContext, nodeId: string): number {
  if (!keepNode(ctx, nodeId)) return 0;
  const churn = lookupMetric(ctx, `churn_${ctx.windowDays}d`, nodeId) ?? 0;
  const complexity = lookupMetric(ctx, pickComplexityMetric(ctx), nodeId) ?? 0;
  if (churn === 0 || complexity === 0) return 0;
  return hotspotScore(ctx, nodeId, churn, complexity);
}

/**
 * churn × complexity, discounted by the file's recency so a freshly-authored
 * file's initial churn burst doesn't read as decay (see recency_{window}d). The
 * factor is 1 (no discount) for files older than the window or when git can't
 * supply an age. Rounded to keep scores integer-friendly for display/thresholds.
 */
function hotspotScore(ctx: ReportContext, nodeId: string, churn: number, complexity: number): number {
  const recency = lookupMetric(ctx, `recency_${ctx.windowDays}d`, nodeId) ?? 1;
  return Math.round(churn * complexity * recency);
}

export function busFactorOf(
  ctx: ReportContext,
  nodeId: string,
): number | undefined {
  return lookupMetric(ctx, `bus_factor_${ctx.windowDays}d`, nodeId);
}

export function topBusFactorRisks(
  ctx: ReportContext,
  limit: number,
): BusFactorRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const bfName = `bus_factor_${ctx.windowDays}d`;
  const shareName = `top_author_share_${ctx.windowDays}d`;
  const rows: BusFactorRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const bf = lookupMetric(ctx, bfName, node.id);
    if (bf === undefined || bf > 1) continue;
    rows.push({
      nodeId: node.id,
      busFactor: bf,
      topAuthorShare: lookupMetric(ctx, shareName, node.id) ?? 1,
      churn: lookupMetric(ctx, churnName, node.id) ?? 0,
    });
  }
  rows.sort((a, b) => b.churn - a.churn);
  return rows.slice(0, limit);
}

/**
 * Sources whose *test coverage* is a single-author silo (test bus factor = 1)
 * — the honest, role-split view: production code can be well-spread while the
 * tests that guard it are owned by one person (or vice versa).
 */
export function topTestCoverageRisks(
  ctx: ReportContext,
  limit: number,
): TestCoverageRow[] {
  const bfName = `test_bus_factor_${ctx.windowDays}d`;
  const shareName = `test_top_author_share_${ctx.windowDays}d`;
  const rows: TestCoverageRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const bf = lookupMetric(ctx, bfName, node.id);
    if (bf === undefined || bf > 1) continue;
    rows.push({
      nodeId: node.id,
      testBusFactor: bf,
      testTopAuthorShare: lookupMetric(ctx, shareName, node.id) ?? 1,
      linkedTests: lookupMetric(ctx, "linked_test_count", node.id) ?? 0,
    });
  }
  rows.sort((a, b) => b.linkedTests - a.linkedTests);
  return rows.slice(0, limit);
}

export function topCouplingClusters(
  ctx: ReportContext,
  repoRoot: string,
  windowDays: number,
  limit: number,
): CouplingRow[] {
  const entries = loadChurnEntries({
    repoRoot,
    windowDays,
    knownFileIds: collectKeptFileIds(ctx),
  });
  if (entries === null) return [];
  const { pairs } = computeChangeCoupling(entries, { minCount: 2 });
  const filtered = pairs.filter(
    (p) => keepNode(ctx, p.fileA) && keepNode(ctx, p.fileB),
  );
  return filtered.slice(0, limit).map(toCouplingRow);
}

function toCouplingRow(p: CoEditPair): CouplingRow {
  return { fileA: p.fileA, fileB: p.fileB, count: p.count };
}

export function topCentralFiles(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ctx: ReportContext,
  limit: number,
): CentralRow[] {
  const pageRank = computePageRank(nodes, edges, {});
  const rows: CentralRow[] = [];
  for (const r of pageRank.rows) {
    if (!keepNode(ctx, r.nodeId)) continue;
    rows.push({ nodeId: r.nodeId, score: r.score });
    if (rows.length >= limit) break;
  }
  return rows;
}

function collectKeptFileIds(ctx: ReportContext): Set<string> {
  const out = new Set<string>();
  for (const node of ctx.nodes) if (keepNode(ctx, node.id)) out.add(node.id);
  return out;
}

/**
 * The set of files re-exported by a `barrel`-role node (1-hop `re-exports`
 * edges) — i.e. files whose exports form a package's public surface. An unused
 * export declared in one of these may still be consumed *externally* (by an npm
 * consumer of a published package), so it's flagged lower-confidence rather than
 * excluded. Transitive barrel chains are not followed (v1); a symbol behind two
 * barrels reads as internal.
 */
export function publicApiFiles(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Set<string> {
  const barrels = new Set(
    nodes.filter((n) => n.role === "barrel").map((n) => n.id),
  );
  const out = new Set<string>();
  for (const e of edges) {
    if (e.kind === "re-exports" && barrels.has(e.srcId)) out.add(e.dstId);
  }
  return out;
}

/**
 * Exported symbols (C-64 `attrs.exported`) with zero inbound `references` — an
 * export that nothing imports by name (utilization is barrel-resolved, C-53, so
 * an export used *through* a barrel reads > 0). Framed as "no reference found",
 * not "dead": it may be used only internally within its own file, or consumed
 * externally if the repo is a published library — hence the `publicApi` split.
 * Ranked by the export's own cognitive complexity (a complex unused export is
 * the most worth removing), scoped to kept (non-excluded) files.
 */
export function topUnusedExports(
  symbolNodes: readonly GraphNode[],
  publicApi: ReadonlySet<string>,
  ctx: ReportContext,
  limit: number,
): UnusedExportRow[] {
  const rows: UnusedExportRow[] = [];
  for (const n of symbolNodes) {
    if (n.kind !== "symbol" || n.attrs?.exported !== true) continue;
    if ((lookupMetric(ctx, "utilization", n.id) ?? 0) > 0) continue;
    const fileId = n.parentId;
    if (!fileId || !keepNode(ctx, fileId)) continue;
    rows.push({
      nodeId: n.id,
      name: n.name,
      fileId,
      cognitive: lookupMetric(ctx, "symbol_cognitive", n.id) ?? 0,
      publicApi: publicApi.has(fileId),
    });
  }
  rows.sort(
    (a, b) =>
      Number(a.publicApi) - Number(b.publicApi) ||
      b.cognitive - a.cognitive ||
      a.nodeId.localeCompare(b.nodeId),
  );
  return rows.slice(0, limit);
}

/**
 * Roles that seed reachability (and are never themselves "dead"): package
 * barrels (entry points / re-export hubs), tests, scripts, configs, and
 * fixtures. Everything a repo actually runs is reachable from these — with
 * dynamic `import()` edges now captured (C-65), the CLI's lazily-loaded command
 * surface is reachable too, so live commands aren't falsely flagged.
 */
const ENTRY_ROOT_ROLES = new Set(["barrel", "test", "script", "config", "fixture"]);

/**
 * A file that is conventionally a bundler entry point even though nothing imports
 * it — a `main.{ts,tsx,js,jsx}` (Vite/CRA/webpack default, referenced from
 * `index.html`, not from code). Seeds reachability so a whole SPA under it isn't
 * flagged unreferenced. (`index.*` is already the `barrel` role.)
 */
const ENTRY_FILE_RE = /(?:^|\/)main\.[jt]sx?$/;

function isEntryRoot(node: GraphNode): boolean {
  return (
    node.kind === "file" &&
    ((node.role !== undefined && ENTRY_ROOT_ROLES.has(node.role)) ||
      ENTRY_FILE_RE.test(node.id))
  );
}

/**
 * Files unreachable from the entry roots by a forward BFS over `imports` /
 * `re-exports` edges — "no importer found given configured entry points" (C-65),
 * NOT proven dead. Catches transitively-dead chains, not just fan-in-0 files.
 * Blind spots (disclosed): a computed dynamic `import(variable)`, DI/registry
 * strings, and any package entry that isn't an index barrel escape the roots and
 * could make a live file look dead — so treat it as a lead, not a verdict.
 * Ranked by LOC (a large unreferenced file is the most worth removing).
 */
export function topDeadModules(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ctx: ReportContext,
  limit: number,
): DeadModuleRow[] {
  const reached = reachableFromEntryRoots(nodes, edges);
  const rows: DeadModuleRow[] = [];
  for (const n of nodes) {
    if (n.kind !== "file" || reached.has(n.id) || isEntryRoot(n)) continue;
    if (!keepNode(ctx, n.id)) continue;
    rows.push({ nodeId: n.id, loc: lookupMetric(ctx, "loc", n.id) ?? 0, role: n.role ?? "source" });
  }
  rows.sort((a, b) => b.loc - a.loc || a.nodeId.localeCompare(b.nodeId));
  return rows.slice(0, limit);
}

/** Adjacency of forward module edges (`imports` / `re-exports`) by source file. */
function outgoingModuleEdges(
  edges: readonly GraphEdge[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "imports" && e.kind !== "re-exports") continue;
    const bucket = out.get(e.srcId);
    if (bucket) bucket.push(e.dstId);
    else out.set(e.srcId, [e.dstId]);
  }
  return out;
}

/** Files reachable from the entry roots by a forward BFS over module edges. */
function reachableFromEntryRoots(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Set<string> {
  const out = outgoingModuleEdges(edges);
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const n of nodes) {
    if (isEntryRoot(n)) {
      reached.add(n.id);
      queue.push(n.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const dst of out.get(queue[i]!) ?? []) {
      if (reached.has(dst)) continue;
      reached.add(dst);
      queue.push(dst);
    }
  }
  return reached;
}
