import type { Command } from "commander";
import chalk from "chalk";
import {
  runGraphIndex,
  type GraphIndexOptions,
  type GraphIndexResult,
} from "@codewatch/graph";
import { formatError } from "../utils/output.js";

export interface GraphIndexCommandOptions extends GraphIndexOptions {
  json?: boolean;
}

export async function runGraphIndexCommand(
  options: GraphIndexCommandOptions,
): Promise<{ result: GraphIndexResult; output: string }> {
  const result = await runGraphIndex(options);
  const output = options.json
    ? formatGraphIndexJson(result)
    : formatGraphIndexText(result);
  return { result, output };
}

function formatKindBreakdown(byKind: Record<string, number>): string {
  const entries = Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, n]) => `${n} ${k}`).join(", ");
}

function formatGraphIndexText(result: GraphIndexResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold.underline(`Graph index: ${result.dbPath}`));
  lines.push(chalk.cyan(`Snapshot ${result.snapshotId}`));
  lines.push("");
  lines.push(`${chalk.bold("Files:")}  ${result.files}`);
  lines.push(
    `${chalk.bold("Nodes:")}  ${result.nodes}` +
      (result.nodes > 0
        ? chalk.dim(`  (${formatKindBreakdown(result.nodesByKind)})`)
        : ""),
  );
  lines.push(
    `${chalk.bold("Edges:")}  ${result.edges}` +
      (result.edges > 0
        ? chalk.dim(`  (${formatKindBreakdown(result.edgesByKind)})`)
        : ""),
  );
  if (result.aliases > 0) {
    lines.push(
      `${chalk.bold("Renames:")} ${result.aliases} ${chalk.dim("(from git diff -M)")}`,
    );
  }
  if (result.metrics > 0) {
    lines.push(
      `${chalk.bold("Metrics:")} ${result.metrics} ${chalk.dim("(degree + source-content + churn + ownership)")}`,
    );
  }
  if (result.reusedFiles > 0) {
    lines.push(
      `${chalk.bold("Reused:")}  ${result.reusedFiles} ${chalk.dim(
        `(unchanged; ${result.reparsedFiles} re-parsed)`,
      )}`,
    );
  }
  lines.push("");
  const d = result.durationMs;
  lines.push(
    chalk.dim(
      `walk ${d.walk.toFixed(0)}ms  ` +
        `read ${d.read.toFixed(0)}ms  ` +
        `parse ${d.parse.toFixed(0)}ms  ` +
        `extract ${d.extract.toFixed(0)}ms  ` +
        `metrics ${d.metrics.toFixed(0)}ms  ` +
        `persist ${d.persist.toFixed(0)}ms  ` +
        `total ${d.total.toFixed(0)}ms`,
    ),
  );
  return lines.join("\n");
}

export function formatGraphIndexJson(result: GraphIndexResult): string {
  return JSON.stringify(result, null, 2);
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

/** Parse `--churn-windows` (variadic and/or comma-separated) into positive days. */
function asNumberList(values: string[] | undefined): number[] | undefined {
  if (values === undefined) return undefined;
  const out = values
    .flatMap((v) => v.split(","))
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return out.length > 0 ? out : undefined;
}

export function registerGraphIndex(graphCmd: Command): void {
  graphCmd
    .command("index <paths...>")
    .description(
      "Build a code graph snapshot. Pass one or more directories to walk; node ids are rooted at the git toplevel so importers across subtrees share the same id space (e.g. `graph index packages tests`).",
    )
    .option(
      "--db <path>",
      "Database path (default: <git-toplevel>/.codewatch/graph.db)",
    )
    .option("--ref <ref>", "Snapshot ref label", "wd")
    .option("--ts-config <path>", "Path to tsconfig.json for ts-morph")
    .option(
      "--no-detect-renames",
      "Skip git rename detection (no id_alias entries)",
    )
    .option(
      "--no-compute-metrics",
      "Skip pure-graph metrics (fan_in, fan_out, instability)",
    )
    .option(
      "--no-churn",
      "Skip git churn metrics (churn_30d, churn_30d_commits, churn_30d_authors)",
    )
    .option(
      "--churn-window <days>",
      "Primary window (days) for churn/ownership/coupling metrics (default 30)",
    )
    .option(
      "--churn-windows <days...>",
      "Comma- or space-separated windows to store churn for so the dashboard switcher can resolve each (default 30,90,180)",
    )
    .option(
      "--lifetime",
      "Also compute an all-time churn/ownership window over full git history (real bus factor, lifetime hotspots) for cold-auditing an unfamiliar repo",
    )
    .option(
      "--no-incremental",
      "Force a full index — disable byte-identical file reuse (default: reuse the prior snapshot for unchanged files, falling back to a full index when files are added or removed)",
    )
    .option("--json", "Output structured JSON")
    .action(
      async (
        rootDirs: string[],
        options: {
          db?: string;
          ref?: string;
          tsConfig?: string;
          detectRenames?: boolean;
          computeMetrics?: boolean;
          churn?: boolean;
          churnWindow?: string;
          churnWindows?: string[];
          lifetime?: boolean;
          incremental?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          const { output } = await runGraphIndexCommand({
            rootDirs,
            dbPath: options.db,
            ref: options.ref,
            tsConfigPath: options.tsConfig,
            detectRenames: options.detectRenames,
            computeMetrics: options.computeMetrics,
            computeChurn: options.churn,
            churnWindowDays: asNumber(options.churnWindow),
            churnWindows: asNumberList(options.churnWindows),
            lifetime: options.lifetime,
            incremental: options.incremental,
            json: options.json,
          });
          console.log(output);
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
