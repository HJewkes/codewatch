import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  openDatabase,
  runChecks,
  validateRules,
  type CheckResult,
  type CheckRule,
  type GraphDatabase,
  type SnapshotRow,
} from "@code-style/graph";

export interface GraphCheckCommandOptions {
  db: string;
  config: string;
  snapshot?: number;
  baseline?: string;
  json?: boolean;
}

export interface GraphCheckCommandResult {
  snapshot: SnapshotRow;
  baselineSnapshot?: SnapshotRow;
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
    const baselineSnapshot = options.baseline
      ? resolveSnapshot(db, options.baseline, "--baseline", snapshot.id)
      : undefined;
    const result = runChecks(db, {
      snapshotId: snapshot.id,
      rules,
      baselineSnapshotId: baselineSnapshot?.id,
    });
    return { snapshot, baselineSnapshot, configPath, rules, result };
  } finally {
    db.close();
  }
}

function resolveSnapshot(
  db: GraphDatabase,
  spec: string,
  flag: string,
  headSnapshotId?: number,
): SnapshotRow {
  if (spec === "previous") {
    const recent = db.listSnapshots({ limit: 5 });
    const previous = recent.find((s) => s.id !== headSnapshotId);
    if (!previous) {
      throw new Error(
        `${flag}: "previous" requires at least one prior snapshot — ` +
          "this is the first run. Bootstrap with `code-style graph index <path>` and try again.",
      );
    }
    return previous;
  }
  if (/^\d+$/.test(spec)) {
    const snap = db.getSnapshot(Number(spec));
    if (!snap) throw new Error(`${flag}: no snapshot with id ${spec}`);
    return snap;
  }
  const snap = db.getLatestSnapshotByRef(spec);
  if (!snap) {
    throw new Error(
      `${flag}: no snapshot found for ref "${spec}". ` +
        `Run \`code-style graph index --ref ${spec} <path>\` against this DB first.`,
    );
  }
  return snap;
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

function severityIcon(severity: string, isCarryover: boolean): string {
  const prefix = isCarryover ? chalk.dim("CARRY ") : "";
  if (severity === "error") return `${prefix}${chalk.red.bold("ERROR  ")}`;
  return `${prefix}${chalk.yellow.bold("WARN   ")}`;
}

function formatHeading(result: GraphCheckCommandResult): string {
  const snap = `snap ${result.snapshot.id} (${result.snapshot.ref})`;
  if (!result.baselineSnapshot) {
    return `Graph check: ${snap} — ${result.configPath}`;
  }
  const base = `snap ${result.baselineSnapshot.id} (${result.baselineSnapshot.ref})`;
  return `Graph check: ${snap} vs baseline ${base} — ${result.configPath}`;
}

export function formatGraphCheckText(result: GraphCheckCommandResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold.underline(formatHeading(result)));
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
    const newCount = violations.filter((v) => !v.isCarryover).length;
    const carryCount = violations.length - newCount;
    const header = result.baselineSnapshot
      ? `${ruleId} (${newCount} new, ${carryCount} carryover)`
      : `${ruleId} (${violations.length})`;
    lines.push(chalk.bold(header));
    for (const v of violations) {
      lines.push(
        `  ${severityIcon(v.severity, v.isCarryover ?? false)}${v.nodeId}  ${chalk.dim(v.message)}`,
      );
    }
    lines.push("");
  }

  lines.push(formatStatus(result.result, !!result.baselineSnapshot));
  return lines.join("\n");
}

function formatStatus(result: CheckResult, hasBaseline: boolean): string {
  if (!hasBaseline) {
    const errors = result.newErrors;
    const warnings = result.newWarnings;
    return result.passed
      ? chalk.yellow(`${warnings} warning(s) — passed.`)
      : chalk.red(`${errors} error(s), ${warnings} warning(s) — failed.`);
  }
  const carry = `${result.carryoverErrors + result.carryoverWarnings} carryover`;
  if (result.passed) {
    return chalk.green(
      `✓ no new violations (${result.newWarnings} new warning(s), ${carry}).`,
    );
  }
  return chalk.red(
    `${result.newErrors} new error(s), ${result.newWarnings} new warning(s), ${carry} — failed.`,
  );
}

export function formatGraphCheckJson(result: GraphCheckCommandResult): string {
  return JSON.stringify(
    {
      snapshot: result.snapshot,
      baselineSnapshot: result.baselineSnapshot ?? null,
      configPath: result.configPath,
      result: result.result,
    },
    null,
    2,
  );
}
