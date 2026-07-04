import type { GraphEdge, GraphNode } from "@codewatch/graph";
import type {
  DeadModuleRow,
  GrowthRiskRow,
  UntestedRiskRow,
  UnusedExportRow,
} from "./graph-report-types.js";
import {
  hotspotScoreOf,
  keepNode,
  lookupMetric,
  type ReportContext,
} from "./graph-report-sections.js";

/**
 * Code-quality report sections built on the C-64 symbol layer + C-65/C-66
 * dead-code / growth-risk metrics: unused exports, unreferenced files, and
 * scaling smells. Split out of graph-report-sections.ts to keep each file under
 * the max-file-loc ceiling (extract, don't append).
 */

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

const LOOP_SHAPES: Record<number, string> = { 2: "quadratic-shaped", 3: "cubic-shaped" };

/** A loop-nesting depth's scaling-smell label — a shape, never a proven bound. */
function loopShape(depth: number): string {
  return LOOP_SHAPES[depth] ?? `${depth}-deep loop nesting`;
}

/** The scaling smells a file exhibits, in reading order (deep loops → recursion → search). */
function fileSmells(ctx: ReportContext, nodeId: string): string[] {
  const smells: string[] = [];
  const depth = lookupMetric(ctx, "loop_depth", nodeId) ?? 0;
  if (depth >= 2) smells.push(`${loopShape(depth)} loop nesting`);
  const rec = lookupMetric(ctx, "recursive_functions", nodeId) ?? 0;
  if (rec > 0) smells.push(`${rec} recursive function${rec === 1 ? "" : "s"}`);
  const search = lookupMetric(ctx, "search_in_loop", nodeId) ?? 0;
  if (search > 0) smells.push(`${search} linear search${search === 1 ? "" : "es"} in loops`);
  return smells;
}

/**
 * Files carrying a structural scaling smell (C-66): deep loop nesting, direct
 * recursion, or a linear-scan method call inside a loop. A HEURISTIC, not Big-O:
 * depth-2 loops over two different collections are linear, `.includes` on a `Set`
 * is O(1), and recursion may be well-bounded. Ranked by loop depth, then smell
 * count.
 */
export function topGrowthRisks(
  ctx: ReportContext,
  limit: number,
): GrowthRiskRow[] {
  const rows: GrowthRiskRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const smells = fileSmells(ctx, node.id);
    if (smells.length === 0) continue;
    rows.push({
      nodeId: node.id,
      loopDepth: lookupMetric(ctx, "loop_depth", node.id) ?? 0,
      smells,
    });
  }
  rows.sort(
    (a, b) =>
      b.loopDepth - a.loopDepth ||
      b.smells.length - a.smells.length ||
      a.nodeId.localeCompare(b.nodeId),
  );
  return rows.slice(0, limit);
}

/**
 * Files that are load-bearing + complex + churning AND under-tested (C-63) —
 * the sharpest single risk signal: `hotspot × (1 − coverage/100)`. Requires an
 * ingested coverage overlay (`graph coverage`); with no coverage, the section is
 * empty (never a stale or assumed number — coverage is an overlay, not inferred).
 * A fully-covered hotspot (coverage 100) scores 0 and drops out.
 */
export function topUntestedRisks(
  ctx: ReportContext,
  limit: number,
): UntestedRiskRow[] {
  const rows: UntestedRiskRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const coverage = lookupMetric(ctx, "coverage_pct", node.id);
    if (coverage === undefined || coverage >= 100) continue;
    const hotspot = hotspotScoreOf(ctx, node.id);
    const score = Math.round(hotspot * (1 - coverage / 100));
    if (score <= 0) continue;
    rows.push({ nodeId: node.id, coverage, hotspot, score });
  }
  rows.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
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
