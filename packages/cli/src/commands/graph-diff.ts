import type { Command } from "commander";
import chalk from "chalk";
import {
  diffSnapshots,
  type GraphDiff,
  type SnapshotRow,
} from "@titan-design/code-graph";
import { formatError } from "../utils/output.js";
import { openGraphStore, defaultGraphDbPath } from "../utils/graph-store.js";
import { resolveSnapshotRef } from "../utils/snapshot-ref.js";
import {
  formatGraphDiffFootprintJson,
  formatGraphDiffFootprintText,
  runGraphDiffFootprintCommand,
  type GraphDiffFootprintOptions,
} from "./graph-diff-footprint.js";

export interface GraphDiffCommandOptions {
  db: string;
  from: string;
  to: string;
  json?: boolean;
}

export interface GraphDiffCommandResult {
  fromSnapshot: SnapshotRow;
  toSnapshot: SnapshotRow;
  diff: GraphDiff;
  durationMs: number;
}

export async function runGraphDiffCommand(
  options: GraphDiffCommandOptions,
): Promise<GraphDiffCommandResult> {
  const start = performance.now();
  const db = openGraphStore(options.db);
  try {
    const toSnapshot = resolveSnapshotRef(db, options.to, { flag: "--to" });
    const fromSnapshot = resolveSnapshotRef(db, options.from, {
      flag: "--from",
      currentId: toSnapshot.id,
    });
    const diff = diffSnapshots(db, {
      fromSnapshotId: fromSnapshot.id,
      toSnapshotId: toSnapshot.id,
    });
    return {
      fromSnapshot,
      toSnapshot,
      diff,
      durationMs: performance.now() - start,
    };
  } finally {
    db.close();
  }
}

function shortHash(commit: string | null): string {
  return commit ? commit.slice(0, 7) : "—";
}

function snapshotLabel(snap: SnapshotRow): string {
  return `snap ${snap.id} (${snap.ref}@${shortHash(snap.commitHash)})`;
}

function formatSign(n: number): string {
  if (n > 0) return chalk.green(`+${n}`);
  if (n < 0) return chalk.red(String(n));
  return chalk.dim(String(n));
}

function formatDelta(d: number | null): string {
  if (d === null) return chalk.dim("—");
  if (d > 0) return chalk.green(`+${d}`);
  if (d < 0) return chalk.red(String(d));
  return chalk.dim("0");
}

function formatHeader(result: GraphDiffCommandResult): string[] {
  const { fromSnapshot, toSnapshot } = result;
  return [
    chalk.bold.underline(
      `Graph diff: ${snapshotLabel(fromSnapshot)} → ${snapshotLabel(toSnapshot)}`,
    ),
    "",
  ];
}

function formatNodeSection(diff: GraphDiff): string[] {
  const s = diff.summary;
  return [
    chalk.bold("Nodes"),
    `  ${formatSign(s.addedNodes)} added`,
    `  ${formatSign(-s.removedNodes)} removed`,
    `  ${chalk.cyan(String(s.renamedNodes))} renamed`,
    `  ${chalk.dim(`${s.unchangedNodes} unchanged`)}`,
    "",
  ];
}

function formatEdgeSection(diff: GraphDiff): string[] {
  const s = diff.summary;
  return [
    chalk.bold("Edges"),
    `  ${formatSign(s.addedEdges)} added`,
    `  ${formatSign(-s.removedEdges)} removed`,
    "",
  ];
}

function formatRenameSection(diff: GraphDiff, max = 10): string[] {
  if (diff.renamedNodes.length === 0) return [];
  const lines = [chalk.bold(`Renames (${diff.renamedNodes.length})`)];
  for (const r of diff.renamedNodes.slice(0, max)) {
    lines.push(`  ${chalk.dim(`(${r.reason})`)}  ${r.oldId} → ${r.newId}`);
  }
  if (diff.renamedNodes.length > max) {
    lines.push(chalk.dim(`  … and ${diff.renamedNodes.length - max} more`));
  }
  lines.push("");
  return lines;
}

function formatMetricSection(diff: GraphDiff, max = 10): string[] {
  if (diff.metricDeltas.length === 0) return [];
  const lines = [chalk.bold(`Metric changes (${diff.metricDeltas.length})`)];
  const sorted = [...diff.metricDeltas].sort(
    (a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0),
  );
  for (const m of sorted.slice(0, max)) {
    const before = m.before === null ? chalk.dim("—") : String(m.before);
    const after = m.after === null ? chalk.dim("—") : String(m.after);
    lines.push(
      `  ${m.nodeId}  ${chalk.dim(m.name)}  ${before} → ${after}  (${formatDelta(m.delta)})`,
    );
  }
  if (diff.metricDeltas.length > max) {
    lines.push(chalk.dim(`  … and ${diff.metricDeltas.length - max} more`));
  }
  lines.push("");
  return lines;
}

export function formatGraphDiffText(result: GraphDiffCommandResult): string {
  const { diff, durationMs } = result;
  const lines: string[] = [
    ...formatHeader(result),
    ...formatNodeSection(diff),
    ...formatEdgeSection(diff),
    ...formatRenameSection(diff),
    ...formatMetricSection(diff),
    chalk.dim(`diff ${durationMs.toFixed(0)}ms`),
  ];
  return lines.join("\n");
}

export function formatGraphDiffJson(result: GraphDiffCommandResult): string {
  return JSON.stringify(
    {
      from: result.fromSnapshot,
      to: result.toSnapshot,
      diff: result.diff,
      durationMs: result.durationMs,
    },
    null,
    2,
  );
}

interface GraphDiffCliOptions extends GraphDiffFootprintOptions {
  json?: boolean;
  footprint?: boolean;
}

async function renderGraphDiff(options: GraphDiffCliOptions): Promise<string> {
  if (options.footprint) {
    const result = await runGraphDiffFootprintCommand(options);
    return options.json ? formatGraphDiffFootprintJson(result) : formatGraphDiffFootprintText(result);
  }
  if (options.units || options.provenance) {
    throw new Error("--units and --provenance require --footprint");
  }
  const result = await runGraphDiffCommand(options);
  return options.json ? formatGraphDiffJson(result) : formatGraphDiffText(result);
}

export function registerGraphDiff(graphCmd: Command): void {
  graphCmd
    .command("diff")
    .description(
      "Diff two graph snapshots (added / removed / renamed nodes + edges, metric deltas)",
    )
    .option("--db <path>", "Path to graph.db", defaultGraphDbPath())
    .requiredOption(
      "--from <ref-or-id>",
      'From-side snapshot: numeric id, ref name, or "previous" (the one before --to)',
    )
    .requiredOption("--to <ref-or-id>", "To-side snapshot: numeric id or ref name")
    .option(
      "--footprint",
      "Diff symbol footprints and gate doc units: changed symbols, units to regenerate, llmCallNeeded",
    )
    .option("--units <file>", "With --footprint: JSON array of {unitId, symbolIds} (default one unit per file)")
    .option("--provenance <file>", "With --footprint: prior unit provenance to gate against")
    .option("--json", "Output structured JSON")
    .action(
      async (options: GraphDiffCliOptions) => {
        try {
          console.log(await renderGraphDiff(options));
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
