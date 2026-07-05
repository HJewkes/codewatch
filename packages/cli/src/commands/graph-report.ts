import type { Command } from "commander";
import * as fs from "node:fs/promises";
import {
  canonicalMetricName,
  compilePatterns,
  openDatabase,
  windowSuffix,
  type ChurnWindow,
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
  type ReportContext,
} from "./graph-report-sections.js";
import {
  topUnusedExports,
  topDeadModules,
  topGrowthRisks,
  topUntestedRisks,
  publicApiFiles,
} from "./graph-report-quality-sections.js";
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
  windowDays?: ChurnWindow;
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
  windowDays: ChurnWindow,
): boolean {
  const name = `churn_${windowSuffix(windowDays)}`;
  return metrics.some((m) => m.name === name && (m.value ?? 0) > 0);
}

function suggestWiderWindow(windowDays: number): number {
  if (windowDays < 90) return 90;
  if (windowDays < 180) return 180;
  return windowDays * 2;
}

function emptyWindowHint(windowDays: ChurnWindow): string {
  // Lifetime already spans all of history — a wider window can't help; the repo
  // simply has no git churn (shallow clone, or non-git tree).
  if (windowDays === "lifetime") {
    return (
      "No churn over the repo's full git history — churn-based sections are " +
      "empty. Check that this is a full (non-shallow) git clone."
    );
  }
  const wider = suggestWiderWindow(windowDays);
  return (
    `No commits in the last ${windowDays}d — churn-based sections are ` +
    `empty. Try a wider window (\`--window-days ${wider}\`) or all-time ` +
    "(`--window-days lifetime`, if the snapshot was indexed with `--lifetime`)."
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
      deadModules: topDeadModules(nodes, edges, ctx, limit),
      growthRisks: topGrowthRisks(ctx, limit),
      untestedRisks: topUntestedRisks(ctx, limit),
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

/**
 * Resolve the requested churn window against what the snapshot actually stored.
 * A snapshot only stores a fixed set of windows (default 30/90/180, plus
 * `lifetime` when indexed with `--lifetime`), so a request for an unstored
 * window (e.g. `--window-days 3650`, or `lifetime` without a lifetime index)
 * can't be honored. Rather than silently substituting another window — which
 * made an established repo read as pristine (C-71) — warn to stderr and fall
 * back to the widest stored window.
 */
function resolveWindowDays(
  metrics: readonly GraphMetric[],
  requested: ChurnWindow,
): ChurnWindow {
  const re = /^churn_(\d+)d$/;
  const available: ChurnWindow[] = [];
  for (const m of metrics) {
    if (m.name === "churn_lifetime") available.push("lifetime");
    const match = re.exec(m.name);
    if (match) available.push(Number(match[1]));
  }
  if (available.length === 0 || available.includes(requested)) return requested;
  // Prefer the widest finite window as the fallback (lifetime sorts last).
  const finite = [...new Set(available.filter((w): w is number => w !== "lifetime"))];
  const fallback = finite.length > 0 ? Math.max(...finite) : available[0]!;
  const hasLifetime = available.includes("lifetime");
  const stored = [
    ...finite.sort((a, b) => a - b).map((w) => `${w}d`),
    ...(hasLifetime ? ["lifetime"] : []),
  ].join(", ");
  process.stderr.write(
    `codewatch: churn window "${windowSuffix(requested)}" was not stored in this ` +
      `snapshot (available: ${stored}); using "${windowSuffix(fallback)}" instead. ` +
      "Re-index with `--churn-windows`/`--lifetime` to store it.\n",
  );
  return fallback;
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

/** Parse `--window-days`: a day count, or the literal `lifetime` for all-time. */
function parseWindow(s: string | undefined): ChurnWindow | undefined {
  if (s === undefined) return undefined;
  return s.toLowerCase() === "lifetime" ? "lifetime" : Number(s);
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
    .option(
      "--window-days <n>",
      "Window for churn/coupling: a day count, or `lifetime` for all-time (needs a `--lifetime` index) (default 30)",
    )
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
            windowDays: parseWindow(options.windowDays),
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
