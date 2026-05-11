import type { Command } from "commander";
import * as fs from "node:fs/promises";
import {
  compilePatterns,
  computeChangeCoupling,
  computePageRank,
  loadChurnEntries,
  matchesAny,
  openDatabase,
  type CoEditPair,
  type GraphDatabase,
  type GraphEdge,
  type GraphNode,
  type GraphMetric,
  type SnapshotRow,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";
import {
  formatGraphReportJson,
  formatGraphReportMarkdown,
} from "./graph-report-format.js";
import type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  GraphReportResult,
  HotspotRow,
} from "./graph-report-types.js";

export { formatGraphReportJson, formatGraphReportMarkdown };
export type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  GraphReportResult,
  HotspotRow,
};

export interface GraphReportCommandOptions {
  db: string;
  repoRoot: string;
  snapshot?: number;
  windowDays?: number;
  limit?: number;
  exclude?: string[];
  excludeRole?: string[];
  out?: string;
  json?: boolean;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 10;
const COMPLEXITY_METRICS = ["cognitive_max", "cyclomatic_max"] as const;

export function runGraphReportCommand(
  options: GraphReportCommandOptions,
): GraphReportResult {
  const db = openDatabase(options.db);
  try {
    const snapshot = pickSnapshot(db, options.snapshot);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const requestedWindow = options.windowDays ?? DEFAULT_WINDOW_DAYS;
    const excluders = compilePatterns(options.exclude);
    const excludedRoles = new Set(options.excludeRole ?? []);

    const nodes = db.listNodes(snapshot.id);
    const edges = db.listEdges(snapshot.id);
    const metrics = db.listMetrics(snapshot.id);
    const windowDays = resolveWindowDays(metrics, requestedWindow);
    const ctx = buildReportContext({
      nodes,
      metrics,
      excluders,
      excludedRoles,
      windowDays,
    });

    return {
      snapshot,
      windowDays,
      hotspots: topHotspots(ctx, limit),
      busFactorRisks: topBusFactorRisks(ctx, limit),
      couplingClusters: topCouplingClusters(ctx, options.repoRoot, windowDays, limit),
      centralFiles: topCentralFiles(nodes, edges, ctx, limit),
    };
  } finally {
    db.close();
  }
}

function pickSnapshot(db: GraphDatabase, id: number | undefined): SnapshotRow {
  const snapshot =
    id !== undefined ? db.getSnapshot(id) : (db.listSnapshots({ limit: 1 })[0] ?? null);
  if (!snapshot) throw new Error("No snapshot found");
  return snapshot;
}

function resolveWindowDays(
  metrics: readonly GraphMetric[],
  requested: number,
): number {
  const re = /^churn_(\d+)d$/;
  const available = new Set<number>();
  for (const m of metrics) {
    const match = re.exec(m.name);
    if (match) available.add(Number(match[1]));
  }
  if (available.has(requested) || available.size === 0) return requested;
  return [...available][0]!;
}

interface ReportContext {
  nodes: readonly GraphNode[];
  nodeById: Map<string, GraphNode>;
  metricsByName: Map<string, Map<string, number>>;
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

interface ReportContextInput {
  nodes: readonly GraphNode[];
  metrics: readonly GraphMetric[];
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

function buildReportContext(input: ReportContextInput): ReportContext {
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

function keep(ctx: ReportContext, nodeId: string): boolean {
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

function topHotspots(ctx: ReportContext, limit: number): HotspotRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const complexityName = pickComplexityMetric(ctx);
  const rows: HotspotRow[] = [];
  for (const node of ctx.nodes) {
    if (!keep(ctx, node.id)) continue;
    const churn = lookupMetric(ctx, churnName, node.id) ?? 0;
    const complexity = lookupMetric(ctx, complexityName, node.id) ?? 0;
    if (churn === 0 || complexity === 0) continue;
    rows.push({ nodeId: node.id, churn, complexity, score: churn * complexity });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

function topBusFactorRisks(ctx: ReportContext, limit: number): BusFactorRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const bfName = `bus_factor_${ctx.windowDays}d`;
  const shareName = `top_author_share_${ctx.windowDays}d`;
  const rows: BusFactorRow[] = [];
  for (const node of ctx.nodes) {
    if (!keep(ctx, node.id)) continue;
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

function topCouplingClusters(
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
  const pairs = computeChangeCoupling(entries, { minCount: 2 });
  const filtered = pairs.filter(
    (p) => keep(ctx, p.fileA) && keep(ctx, p.fileB),
  );
  return filtered.slice(0, limit).map(toCouplingRow);
}

function toCouplingRow(p: CoEditPair): CouplingRow {
  return { fileA: p.fileA, fileB: p.fileB, count: p.count };
}

function topCentralFiles(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ctx: ReportContext,
  limit: number,
): CentralRow[] {
  const pageRank = computePageRank(nodes, edges, {});
  const rows: CentralRow[] = [];
  for (const r of pageRank.rows) {
    if (!keep(ctx, r.nodeId)) continue;
    rows.push({ nodeId: r.nodeId, score: r.score });
    if (rows.length >= limit) break;
  }
  return rows;
}

function collectKeptFileIds(ctx: ReportContext): Set<string> {
  const out = new Set<string>();
  for (const node of ctx.nodes) if (keep(ctx, node.id)) out.add(node.id);
  return out;
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

export function registerGraphReport(graphCmd: Command): void {
  graphCmd
    .command("report")
    .description(
      "Health report combining hotspots, knowledge-silos, coupling clusters, and centrality (Move 7 debt rollup).",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--repo-root <path>", "Repo root (for git log)", ".")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--window-days <n>", "Window for churn/coupling (default 30)")
    .option("--limit <n>", "Rows per section (default 10)")
    .option(
      "--exclude <pattern...>",
      "Exclude file ids matching this glob or substring (repeatable)",
    )
    .option(
      "--exclude-role <role...>",
      "Exclude files with this role (test, fixture, …; repeatable)",
    )
    .option("--out <path>", "Write markdown to this file instead of stdout")
    .option("--json", "Output structured JSON instead of markdown")
    .action(
      async (options: {
        db: string;
        repoRoot: string;
        snapshot?: string;
        windowDays?: string;
        limit?: string;
        exclude?: string[];
        excludeRole?: string[];
        out?: string;
        json?: boolean;
      }) => {
        try {
          const result = runGraphReportCommand({
            db: options.db,
            repoRoot: options.repoRoot,
            snapshot: asNumber(options.snapshot),
            windowDays: asNumber(options.windowDays),
            limit: asNumber(options.limit),
            exclude: options.exclude,
            excludeRole: options.excludeRole,
            out: options.out,
          });
          const text = options.json
            ? formatGraphReportJson(result)
            : formatGraphReportMarkdown(result);
          if (options.out) {
            await fs.writeFile(options.out, text + "\n", "utf-8");
            console.log(`Wrote report to ${options.out}`);
          } else {
            console.log(text);
          }
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
