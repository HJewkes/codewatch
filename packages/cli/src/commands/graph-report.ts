import type { Command } from "commander";
import * as fs from "node:fs/promises";
import {
  canonicalMetricName,
  compilePatterns,
  openDatabase,
  type GraphDatabase,
  type GraphMetric,
  type SnapshotRow,
} from "@codewatch/graph";
import { formatError, snapshotVersionMismatchWarning } from "../utils/output.js";
import { computeReportDrift } from "./graph-report-drift.js";
import {
  formatGraphReportJson,
  formatGraphReportMarkdown,
} from "./graph-report-format.js";
import {
  buildReportContext,
  busFactorOf,
  hotspotScoreOf,
  topBusFactorRisks,
  topCentralFiles,
  topCouplingClusters,
  topHotspots,
  topTestCoverageRisks,
  topUnusedExports,
  publicApiFiles,
  type ReportContext,
} from "./graph-report-sections.js";
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
  vs?: string;
  windowDays?: number;
  limit?: number;
  exclude?: string[];
  excludeRole?: string[];
  includeScripts?: boolean;
  out?: string;
  json?: boolean;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 10;

/**
 * `script` role (scripts/, archive/) is report noise by default; `--exclude-role`
 * is additive on top, and `--include-scripts` opts scripts back in.
 */
function resolveExcludedRoles(options: GraphReportCommandOptions): Set<string> {
  const roles = new Set(options.excludeRole ?? []);
  if (!options.includeScripts) roles.add("script");
  return roles;
}

function hasChurnSignal(
  metrics: readonly GraphMetric[],
  windowDays: number,
): boolean {
  const name = `churn_${windowDays}d`;
  return metrics.some((m) => m.name === name && (m.value ?? 0) > 0);
}

function suggestWiderWindow(windowDays: number): number {
  if (windowDays < 90) return 90;
  if (windowDays < 180) return 180;
  return windowDays * 2;
}

function emptyWindowHint(windowDays: number): string {
  const wider = suggestWiderWindow(windowDays);
  return (
    `No commits in the last ${windowDays}d — churn-based sections are ` +
    `empty. Try a wider window: \`--window-days ${wider}\`.`
  );
}

export function runGraphReportCommand(
  options: GraphReportCommandOptions,
): GraphReportResult {
  const db = openDatabase(options.db);
  try {
    const snapshot = pickSnapshot(db, options.snapshot);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const requestedWindow = options.windowDays ?? DEFAULT_WINDOW_DAYS;
    const excluders = compilePatterns(options.exclude);
    const excludedRoles = resolveExcludedRoles(options);

    const nodes = db.listNodes(snapshot.id);
    const edges = db.listEdges(snapshot.id);
    const symbolNodes = db.listNodes(snapshot.id, { includeSymbols: true });
    const metrics = db.listMetrics(snapshot.id);
    const windowDays = resolveWindowDays(metrics, requestedWindow);
    const ctx = buildReportContext({
      nodes,
      metrics,
      excluders,
      excludedRoles,
      windowDays,
    });

    const result: GraphReportResult = {
      snapshot,
      windowDays,
      hotspots: topHotspots(ctx, limit),
      busFactorRisks: topBusFactorRisks(ctx, limit),
      testCoverageRisks: topTestCoverageRisks(ctx, limit),
      couplingClusters: topCouplingClusters(ctx, options.repoRoot, windowDays, limit),
      centralFiles: topCentralFiles(nodes, edges, ctx, limit),
      unusedExports: topUnusedExports(symbolNodes, publicApiFiles(nodes, edges), ctx, limit),
    };
    if (!hasChurnSignal(metrics, windowDays)) {
      result.emptyWindow = true;
      result.hint = emptyWindowHint(windowDays);
    }
    if (options.vs) {
      result.drift = computeDrift(db, options, ctx, result, limit);
    }
    return result;
  } finally {
    db.close();
  }
}

/**
 * Heal deprecated metric names read back from an older snapshot so a baseline
 * indexed before a metric rename still resolves against current report lookups.
 */
function canonicalizeMetricNames(metrics: GraphMetric[]): GraphMetric[] {
  return metrics.map((m) => {
    const name = canonicalMetricName(m.name);
    return name === m.name ? m : { ...m, name };
  });
}

function computeDrift(
  db: GraphDatabase,
  options: GraphReportCommandOptions,
  currentCtx: ReportContext,
  current: GraphReportResult,
  limit: number,
): GraphReportResult["drift"] {
  const baselineSnapshot = resolveSnapshot(db, options.vs!, current.snapshot.id);
  if (baselineSnapshot.id === current.snapshot.id) return undefined;

  const warning = snapshotVersionMismatchWarning(
    current.snapshot.indexVersion,
    baselineSnapshot.indexVersion,
    "graph report --vs",
  );
  if (warning) console.warn(warning);

  const baseNodes = db.listNodes(baselineSnapshot.id);
  const baseMetrics = canonicalizeMetricNames(db.listMetrics(baselineSnapshot.id));
  const baseWindow = resolveWindowDays(baseMetrics, current.windowDays);
  const baseCtx = buildReportContext({
    nodes: baseNodes,
    metrics: baseMetrics,
    excluders: compilePatterns(options.exclude),
    excludedRoles: resolveExcludedRoles(options),
    windowDays: baseWindow,
  });
  const baseNodeIds = new Set(baseNodes.map((n) => n.id));
  return computeReportDrift({
    baselineSnapshot,
    currentHotspots: current.hotspots,
    baselineHotspots: topHotspots(baseCtx, limit),
    currentHotspotScore: (id) => hotspotScoreOf(currentCtx, id),
    baselineHotspotScore: (id) => (baseNodeIds.has(id) ? hotspotScoreOf(baseCtx, id) : undefined),
    currentSilos: current.busFactorRisks,
    baselineSilos: topBusFactorRisks(baseCtx, limit),
    currentBusFactor: (id) => busFactorOf(currentCtx, id),
    currentCoupling: current.couplingClusters,
    baselineCoupling: topCouplingClusters(baseCtx, options.repoRoot, baseWindow, limit),
  });
}

function pickSnapshot(db: GraphDatabase, id: number | undefined): SnapshotRow {
  const snapshot =
    id !== undefined ? db.getSnapshot(id) : (db.listSnapshots({ limit: 1 })[0] ?? null);
  if (!snapshot) throw new Error("No snapshot found");
  return snapshot;
}

function resolveSnapshot(
  db: GraphDatabase,
  refOrId: string,
  currentId?: number,
): SnapshotRow {
  // "previous" = the most recent snapshot other than the current one — matches
  // `graph check --baseline previous`, so `--vs previous` works consistently.
  if (refOrId === "previous") {
    const previous = db.listSnapshots({ limit: 5 }).find((s) => s.id !== currentId);
    if (!previous) {
      throw new Error(
        `--vs: "previous" requires at least one prior snapshot — this is the first run.`,
      );
    }
    return previous;
  }
  if (/^\d+$/.test(refOrId)) {
    const byId = db.getSnapshot(Number(refOrId));
    if (byId) return byId;
  }
  const byRef = db.getLatestSnapshotByRef(refOrId);
  if (byRef) return byRef;
  throw new Error(`No snapshot matches ref or id "${refOrId}"`);
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
    .option(
      "--vs <ref-or-id>",
      "Add a drift section comparing the current report to this baseline snapshot.",
    )
    .option("--window-days <n>", "Window for churn/coupling (default 30)")
    .option("--limit <n>", "Rows per section (default 10)")
    .option(
      "--exclude <pattern...>",
      "Exclude file ids matching this glob or substring (repeatable)",
    )
    .option(
      "--exclude-role <role...>",
      "Additionally exclude files with this role (test, fixture, …; repeatable)",
    )
    .option(
      "--include-scripts",
      "Include scripts/ and archive/ files (role=script), suppressed by default",
    )
    .option("--out <path>", "Write markdown to this file instead of stdout")
    .option("--json", "Output structured JSON instead of markdown")
    .action(
      async (options: {
        db: string;
        repoRoot: string;
        snapshot?: string;
        vs?: string;
        windowDays?: string;
        limit?: string;
        exclude?: string[];
        excludeRole?: string[];
        includeScripts?: boolean;
        out?: string;
        json?: boolean;
      }) => {
        try {
          const result = runGraphReportCommand({
            db: options.db,
            repoRoot: options.repoRoot,
            snapshot: asNumber(options.snapshot),
            vs: options.vs,
            windowDays: asNumber(options.windowDays),
            limit: asNumber(options.limit),
            exclude: options.exclude,
            excludeRole: options.excludeRole,
            includeScripts: options.includeScripts,
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
