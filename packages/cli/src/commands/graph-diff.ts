import type { Command } from "commander";
import chalk from "chalk";
import {
  diffSnapshots,
  openDatabase,
  type GraphDatabase,
  type GraphDiff,
  type SnapshotRow,
} from "@codewatch/graph";
import { formatError } from "../utils/output.js";

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
  const db = openDatabase(options.db);
  try {
    const fromSnapshot = resolveSnapshot(db, options.from, "--from");
    const toSnapshot = resolveSnapshot(db, options.to, "--to");
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

function resolveSnapshot(
  db: GraphDatabase,
  spec: string,
  flag: string,
): SnapshotRow {
  const asNumber = /^\d+$/.test(spec) ? Number(spec) : null;
  if (asNumber !== null) {
    const snap = db.getSnapshot(asNumber);
    if (!snap) throw new Error(`${flag}: no snapshot with id ${spec}`);
    return snap;
  }
  const snap = db.getLatestSnapshotByRef(spec);
  if (!snap) {
    throw new Error(
      `${flag}: no snapshot found for ref "${spec}". ` +
        `Run \`codewatch graph index --ref ${spec} <path>\` first.`,
    );
  }
  return snap;
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

export function registerGraphDiff(graphCmd: Command): void {
  graphCmd
    .command("diff")
    .description(
      "Diff two graph snapshots (added / removed / renamed nodes + edges, metric deltas)",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .requiredOption(
      "--from <ref-or-id>",
      "From-side snapshot: numeric id or ref name",
    )
    .requiredOption("--to <ref-or-id>", "To-side snapshot: numeric id or ref name")
    .option("--json", "Output structured JSON")
    .action(
      async (options: { db: string; from: string; to: string; json?: boolean }) => {
        try {
          const result = await runGraphDiffCommand(options);
          console.log(
            options.json
              ? formatGraphDiffJson(result)
              : formatGraphDiffText(result),
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
