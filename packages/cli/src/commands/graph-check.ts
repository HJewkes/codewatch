import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  openDatabase,
  runChecks,
  validateRules,
  type CheckResult,
  type CheckRule,
  type SnapshotRow,
} from "@code-style/graph";

export interface GraphCheckCommandOptions {
  db: string;
  config: string;
  snapshot?: number;
  json?: boolean;
}

export interface GraphCheckCommandResult {
  snapshot: SnapshotRow;
  configPath: string;
  rules: readonly CheckRule[];
  result: CheckResult;
}

export async function runGraphCheckCommand(
  options: GraphCheckCommandOptions,
): Promise<GraphCheckCommandResult> {
  const configPath = resolve(options.config);
  const rules = await loadRules(configPath);
  const db = openDatabase(options.db);
  try {
    const snapshot =
      options.snapshot !== undefined
        ? db.getSnapshot(options.snapshot)
        : (db.listSnapshots({ limit: 1 })[0] ?? null);
    if (!snapshot) {
      throw new Error(`No snapshot in ${options.db}`);
    }
    const result = runChecks(db, { snapshotId: snapshot.id, rules });
    return { snapshot, configPath, rules, result };
  } finally {
    db.close();
  }
}

async function loadRules(path: string): Promise<readonly CheckRule[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read rules file at ${path}: ${msg}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${path}: ${msg}`);
  }
  return validateRules(parsed);
}

function severityIcon(severity: string): string {
  if (severity === "error") return chalk.red.bold("ERROR  ");
  return chalk.yellow.bold("WARN   ");
}

export function formatGraphCheckText(result: GraphCheckCommandResult): string {
  const lines: string[] = [];
  lines.push(
    chalk.bold.underline(
      `Graph check: snap ${result.snapshot.id} (${result.snapshot.ref}) — ${result.configPath}`,
    ),
  );
  lines.push("");

  if (result.result.violations.length === 0) {
    lines.push(
      chalk.green(
        `✓ ${result.result.rulesEvaluated} rule(s) passed across ` +
          `${result.result.nodesEvaluated} node(s).`,
      ),
    );
    return lines.join("\n");
  }

  const grouped = new Map<string, typeof result.result.violations>();
  for (const v of result.result.violations) {
    const list = grouped.get(v.ruleId) ?? [];
    list.push(v);
    grouped.set(v.ruleId, list);
  }

  for (const [ruleId, violations] of grouped) {
    lines.push(chalk.bold(`${ruleId} (${violations.length})`));
    for (const v of violations) {
      lines.push(`  ${severityIcon(v.severity)}${v.nodeId}  ${chalk.dim(v.message)}`);
    }
    lines.push("");
  }

  const errors = result.result.violations.filter((v) => v.severity === "error").length;
  const warnings = result.result.violations.filter((v) => v.severity === "warning").length;
  const status = result.result.passed
    ? chalk.yellow(`${warnings} warning(s) — passed.`)
    : chalk.red(`${errors} error(s), ${warnings} warning(s) — failed.`);
  lines.push(status);
  return lines.join("\n");
}

export function formatGraphCheckJson(result: GraphCheckCommandResult): string {
  return JSON.stringify(
    {
      snapshot: result.snapshot,
      configPath: result.configPath,
      result: result.result,
    },
    null,
    2,
  );
}
