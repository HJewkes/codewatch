import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  diffCheckResults,
  openDatabase,
  validateRules,
  type CheckDiff,
  type CheckRule,
  type CheckViolation,
  type GraphDatabase,
  type SnapshotRow,
  type UnchangedViolation,
} from "@code-style/graph";

export interface GraphCheckDiffCommandOptions {
  db: string;
  config: string;
  from: string;
  to: string;
  json?: boolean;
}

export interface GraphCheckDiffCommandResult {
  fromSnapshot: SnapshotRow;
  toSnapshot: SnapshotRow;
  configPath: string;
  rules: readonly CheckRule[];
  diff: CheckDiff;
}

export async function runGraphCheckDiffCommand(
  options: GraphCheckDiffCommandOptions,
): Promise<GraphCheckDiffCommandResult> {
  const configPath = resolve(options.config);
  const rules = await loadRules(configPath);
  const db = openDatabase(options.db);
  try {
    const fromSnapshot = resolveSnapshot(db, options.from, "--from");
    const toSnapshot = resolveSnapshot(db, options.to, "--to");
    const diff = diffCheckResults(db, {
      fromSnapshotId: fromSnapshot.id,
      toSnapshotId: toSnapshot.id,
      rules,
    });
    return { fromSnapshot, toSnapshot, configPath, rules, diff };
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

function resolveSnapshot(
  db: GraphDatabase,
  spec: string,
  flag: string,
): SnapshotRow {
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

function snapLabel(snap: SnapshotRow): string {
  return `snap ${snap.id} (${snap.ref})`;
}

function formatViolationLine(v: CheckViolation, marker: string): string {
  return `  ${marker}  ${v.nodeId}  ${chalk.dim(v.message)}`;
}

function formatUnchangedLine(entry: UnchangedViolation): string {
  if (entry.delta === null) {
    return `  ${chalk.dim("=")}   ${entry.to.nodeId}  ${chalk.dim(entry.to.message)}`;
  }
  const sign = entry.delta > 0 ? chalk.red("↑") : chalk.green("↓");
  return `  ${sign}   ${entry.to.nodeId}  ${chalk.dim(
    `${entry.from.value} → ${entry.to.value} (${entry.delta > 0 ? "+" : ""}${entry.delta})`,
  )}`;
}

interface RuleBucket {
  ruleId: string;
  newViolations: CheckViolation[];
  resolvedViolations: CheckViolation[];
  worsened: UnchangedViolation[];
  improved: UnchangedViolation[];
}

function bucketByRule(diff: CheckDiff): RuleBucket[] {
  const map = new Map<string, RuleBucket>();
  const ensure = (id: string): RuleBucket => {
    let b = map.get(id);
    if (!b) {
      b = { ruleId: id, newViolations: [], resolvedViolations: [], worsened: [], improved: [] };
      map.set(id, b);
    }
    return b;
  };
  for (const v of diff.newViolations) ensure(v.ruleId).newViolations.push(v);
  for (const v of diff.resolvedViolations) ensure(v.ruleId).resolvedViolations.push(v);
  for (const u of diff.worsened) ensure(u.to.ruleId).worsened.push(u);
  for (const u of diff.improved) ensure(u.to.ruleId).improved.push(u);
  return [...map.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export function formatGraphCheckDiffText(result: GraphCheckDiffCommandResult): string {
  const { diff } = result;
  const lines: string[] = [];
  lines.push(
    chalk.bold.underline(
      `Check diff: ${snapLabel(result.fromSnapshot)} → ${snapLabel(result.toSnapshot)} — ${result.configPath}`,
    ),
  );
  lines.push("");

  const buckets = bucketByRule(diff);
  if (buckets.length === 0) {
    lines.push(chalk.green("✓ No violations on either side."));
    return lines.join("\n");
  }

  for (const b of buckets) {
    const counts = [
      b.newViolations.length && chalk.red(`+${b.newViolations.length} new`),
      b.resolvedViolations.length && chalk.green(`-${b.resolvedViolations.length} resolved`),
      b.worsened.length && chalk.red(`↑${b.worsened.length} worsened`),
      b.improved.length && chalk.green(`↓${b.improved.length} improved`),
    ]
      .filter(Boolean)
      .join(", ");
    if (!counts) continue;
    lines.push(chalk.bold(`${b.ruleId}  ${chalk.dim(`(${counts})`)}`));
    for (const v of b.newViolations) lines.push(formatViolationLine(v, chalk.red("+")));
    for (const v of b.resolvedViolations) lines.push(formatViolationLine(v, chalk.green("-")));
    for (const u of b.worsened) lines.push(formatUnchangedLine(u));
    for (const u of b.improved) lines.push(formatUnchangedLine(u));
    lines.push("");
  }

  lines.push(
    chalk.dim(
      `+${diff.newViolations.length} new, ` +
        `-${diff.resolvedViolations.length} resolved, ` +
        `↑${diff.worsened.length} worsened, ` +
        `↓${diff.improved.length} improved ` +
        `(${diff.unchanged.length} unchanged total).`,
    ),
  );
  return lines.join("\n");
}

export function formatGraphCheckDiffJson(result: GraphCheckDiffCommandResult): string {
  return JSON.stringify(
    {
      fromSnapshot: result.fromSnapshot,
      toSnapshot: result.toSnapshot,
      configPath: result.configPath,
      diff: result.diff,
    },
    null,
    2,
  );
}
