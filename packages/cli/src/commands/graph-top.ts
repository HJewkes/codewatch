import chalk from "chalk";
import { openDatabase, type SnapshotRow } from "@code-style/graph";

export interface GraphTopCommandOptions {
  db: string;
  metric: string;
  snapshot?: number;
  limit?: number;
  kind?: string;
  exclude?: string[];
  json?: boolean;
}

export interface GraphTopRow {
  rank: number;
  nodeId: string;
  name: string;
  kind: string;
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
    const excluders = compileExcluders(options.exclude);
    const oversample = excluders.length > 0 ? Math.max(desired * 4, 200) : desired;

    const raw = db.topByMetric({
      snapshotId: snapshot.id,
      metric: options.metric,
      limit: oversample,
      kind: options.kind,
    });

    const filtered = raw.filter((r) => !excluders.some((rx) => rx.test(r.nodeId)));
    const rows: GraphTopRow[] = filtered.slice(0, desired).map((r, i) => ({
      rank: i + 1,
      nodeId: r.nodeId,
      name: r.name,
      kind: r.kind,
      value: r.value,
      unit: r.unit,
    }));

    return { snapshot, metric: options.metric, rows };
  } finally {
    db.close();
  }
}

function compileExcluders(patterns: readonly string[] | undefined): RegExp[] {
  if (!patterns) return [];
  return patterns.map((p) => patternToRegex(p));
}

function patternToRegex(pattern: string): RegExp {
  // Glob support: '**' matches across directories, '*' matches within a segment.
  // Patterns without any '*' are treated as case-sensitive substring matches.
  if (!pattern.includes("*")) {
    return new RegExp(escapeRegex(pattern));
  }
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else {
      out += escapeRegex(c);
    }
  }
  return new RegExp(`^${out}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?(){}|^$\\[\]]/g, "\\$&");
}

function formatValue(v: number | null, unit: string | null): string {
  if (v === null) return chalk.dim("—");
  const formatted =
    Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
  return unit ? `${formatted} ${chalk.dim(unit)}` : formatted;
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function visualWidth(s: string): number {
  return s.replace(/\[[0-9;]*m/g, "").length;
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
