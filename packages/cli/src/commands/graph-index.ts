import chalk from "chalk";
import {
  runGraphIndex,
  type GraphIndexOptions,
  type GraphIndexResult,
} from "@code-style/graph";

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

export function formatGraphIndexText(result: GraphIndexResult): string {
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
