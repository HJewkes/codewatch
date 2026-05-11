import type { Command } from "commander";
import chalk from "chalk";
import {
  openDatabase,
  planPrune,
  runPrune,
  type PruneResult,
  type PrunePlan,
  type SnapshotRow,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";

export interface GraphPruneCommandOptions {
  db: string;
  keep?: number;
  keepRefs?: string[];
  vacuum?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface GraphPruneCommandResult {
  dbPath: string;
  dryRun: boolean;
  plan: PrunePlan;
  result?: PruneResult;
}

export function runGraphPruneCommand(
  options: GraphPruneCommandOptions,
): GraphPruneCommandResult {
  const db = openDatabase(options.db);
  try {
    if (options.dryRun) {
      const plan = planPrune(db, {
        keep: options.keep,
        keepRefs: options.keepRefs,
      });
      return { dbPath: options.db, dryRun: true, plan };
    }
    const result = runPrune(db, {
      keep: options.keep,
      keepRefs: options.keepRefs,
      vacuum: options.vacuum,
    });
    return { dbPath: options.db, dryRun: false, plan: result.plan, result };
  } finally {
    db.close();
  }
}

function describeSnap(s: SnapshotRow): string {
  return `snap ${s.id} (${s.ref}, ${s.takenAt})`;
}

function formatRowsDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): string {
  const tables = Object.keys(before).sort();
  return tables
    .map((t) => {
      const delta = before[t]! - after[t]!;
      const sign = delta > 0 ? chalk.green(`-${delta}`) : chalk.dim("0");
      return `${chalk.bold(t)} ${sign}`;
    })
    .join(", ");
}

export function formatGraphPruneText(result: GraphPruneCommandResult): string {
  const lines: string[] = [];
  const header = result.dryRun
    ? `Graph prune (dry-run): ${result.dbPath}`
    : `Graph prune: ${result.dbPath}`;
  lines.push(chalk.bold.underline(header));
  lines.push("");

  lines.push(
    `${chalk.bold("Keep:")}   ${result.plan.keep.length} snapshot(s)`,
  );
  for (const s of result.plan.keep.slice(0, 5)) lines.push(`  • ${describeSnap(s)}`);
  if (result.plan.keep.length > 5) {
    lines.push(chalk.dim(`  … and ${result.plan.keep.length - 5} more`));
  }
  lines.push("");

  if (result.plan.remove.length === 0) {
    lines.push(chalk.dim("Nothing to remove."));
    return lines.join("\n");
  }

  lines.push(
    `${chalk.bold("Remove:")} ${result.plan.remove.length} snapshot(s)`,
  );
  for (const s of result.plan.remove) lines.push(`  • ${describeSnap(s)}`);
  lines.push("");

  if (result.dryRun) {
    lines.push(chalk.dim("Pass without --dry-run to actually delete."));
    return lines.join("\n");
  }

  if (result.result) {
    lines.push(
      formatRowsDelta(result.result.rowsBefore, result.result.rowsAfter),
    );
    if (result.result.vacuumed) {
      lines.push(chalk.dim("VACUUM applied — disk space reclaimed."));
    }
  }
  return lines.join("\n");
}

export function formatGraphPruneJson(result: GraphPruneCommandResult): string {
  return JSON.stringify(result, null, 2);
}

export function registerGraphPrune(graphCmd: Command): void {
  graphCmd
    .command("prune")
    .description("Delete old snapshots, keeping the most recent N plus any with matching ref")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--keep <n>", "Keep the most recent N snapshots", "10")
    .option(
      "--keep-ref <ref...>",
      "Always keep snapshots with this ref (e.g. main, baseline; repeatable)",
    )
    .option("--vacuum", "Run VACUUM after deletion to reclaim disk space")
    .option("--dry-run", "Print what would be deleted without doing it")
    .option("--json", "Output structured JSON")
    .action(
      (options: {
        db: string;
        keep?: string;
        keepRef?: string[];
        vacuum?: boolean;
        dryRun?: boolean;
        json?: boolean;
      }) => {
        try {
          const result = runGraphPruneCommand({
            db: options.db,
            keep: options.keep !== undefined ? Number(options.keep) : undefined,
            keepRefs: options.keepRef,
            vacuum: options.vacuum,
            dryRun: options.dryRun,
          });
          console.log(
            options.json
              ? formatGraphPruneJson(result)
              : formatGraphPruneText(result),
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
