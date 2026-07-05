import type { Command } from "commander";
import chalk from "chalk";
import {
  compilePatterns,
  matchesAny,
  openDatabase,
  type NodeRole,
  type SnapshotRow,
} from "@codewatch/graph";
import { formatError } from "../utils/output.js";
import { padLeft, padRight, visualWidth } from "../utils/table.js";

export interface GraphTopCommandOptions {
  db: string;
  metric: string;
  snapshot?: number;
  limit?: number;
  kind?: string;
  exclude?: string[];
  excludeRole?: string[];
  json?: boolean;
}

export interface GraphTopRow {
  rank: number;
  nodeId: string;
  name: string;
  kind: string;
  role: NodeRole | null;
  value: number | null;
  unit: string | null;
}

export interface GraphTopResult {
  snapshot: SnapshotRow;
  metric: string;
  rows: GraphTopRow[];
}

export function runGraphTopCommand(
  options: GraphTopCommandOptions,
): GraphTopResult {
  const db = openDatabase(options.db);
  try {
    const snapshot =
      options.snapshot !== undefined
        ? db.getSnapshot(options.snapshot)
        : (db.listSnapshots({ limit: 1 })[0] ?? null);
    if (!snapshot) {
      throw new Error(`No snapshot in ${options.db}`);
    }

    const available = db.listMetricNames(snapshot.id);
    if (!available.includes(options.metric)) {
      throw new Error(
        `metric "${options.metric}" not found in snapshot ${snapshot.id}. ` +
          `Available: ${available.join(", ") || "(none — re-index without --no-compute-metrics)"}`,
      );
    }

    const desired = options.limit ?? 20;
    const excluders = compilePatterns(options.exclude);
    const excludedRoles = new Set(options.excludeRole ?? []);
    // Generated rows are always dropped below, so backfill is always needed.
    const oversample = Math.max(desired * 4, 200);

    const raw = db.topByMetric({
      snapshotId: snapshot.id,
      metric: options.metric,
      limit: oversample,
      kind: options.kind,
    });

    const filtered = raw.filter(
      (r) =>
        r.role !== "generated" &&
        !matchesAny(r.nodeId, excluders) &&
        !(r.role && excludedRoles.has(r.role)),
    );
    const rows: GraphTopRow[] = filtered.slice(0, desired).map((r, i) => ({
      rank: i + 1,
      nodeId: r.nodeId,
      name: r.name,
      kind: r.kind,
      role: (r.role ?? null) as NodeRole | null,
      value: r.value,
      unit: r.unit,
    }));

    return { snapshot, metric: options.metric, rows };
  } finally {
    db.close();
  }
}


function formatValue(v: number | null, unit: string | null): string {
  if (v === null) return chalk.dim("—");
  const formatted =
    Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
  return unit ? `${formatted} ${chalk.dim(unit)}` : formatted;
}

export function formatGraphTopText(result: GraphTopResult): string {
  const lines: string[] = [];
  lines.push(
    chalk.bold.underline(
      `Top by ${result.metric} — snap ${result.snapshot.id} (${result.snapshot.ref})`,
    ),
  );
  lines.push("");

  if (result.rows.length === 0) {
    lines.push(chalk.dim("No nodes have this metric."));
    return lines.join("\n");
  }

  const valueStrings = result.rows.map((r) => formatValue(r.value, r.unit));
  const valueWidth = Math.max(
    ...valueStrings.map(visualWidth),
    "value".length,
  );
  const kindWidth = Math.max(
    ...result.rows.map((r) => r.kind.length),
    "kind".length,
  );

  lines.push(
    chalk.dim(
      `  ${padLeft("rank", 4)}  ${padLeft("value", valueWidth)}  ${padRight("kind", kindWidth)}  id`,
    ),
  );
  for (const r of result.rows) {
    const value = formatValue(r.value, r.unit);
    const valuePad = " ".repeat(Math.max(0, valueWidth - visualWidth(value)));
    lines.push(
      `  ${padLeft(String(r.rank), 4)}  ${valuePad}${value}  ${padRight(r.kind, kindWidth)}  ${r.nodeId}`,
    );
  }
  return lines.join("\n");
}

export function formatGraphTopJson(result: GraphTopResult): string {
  return JSON.stringify(result, null, 2);
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

export function registerGraphTop(graphCmd: Command): void {
  graphCmd
    .command("top")
    .description("List top nodes by a metric (hotspot view)")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .requiredOption(
      "--metric <name>",
      "Metric name (e.g. cyclomatic_max, loc, fan_in)",
    )
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--limit <n>", "Number of rows to return", "20")
    .option(
      "--kind <kind>",
      "Filter to one node kind (file, module, package, external)",
    )
    .option(
      "--exclude <pattern...>",
      "Exclude node ids matching this glob or substring (repeatable)",
    )
    .option(
      "--exclude-role <role...>",
      "Exclude nodes with this role (test, fixture, barrel, types, config; repeatable)",
    )
    .option("--json", "Output structured JSON")
    .action(
      async (options: {
        db: string;
        metric: string;
        snapshot?: string;
        limit?: string;
        kind?: string;
        exclude?: string[];
        excludeRole?: string[];
        json?: boolean;
      }) => {
        try {
          const result = runGraphTopCommand({
            db: options.db,
            metric: options.metric,
            snapshot: asNumber(options.snapshot),
            limit: asNumber(options.limit),
            kind: options.kind,
            exclude: options.exclude,
            excludeRole: options.excludeRole,
          });
          console.log(
            options.json ? formatGraphTopJson(result) : formatGraphTopText(result),
          );
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
