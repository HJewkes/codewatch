import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import {
  openDatabase,
  resolveGitRef,
  runChecks,
  validateRules,
  type CheckResult,
  type CheckRule,
  type GraphDatabase,
  type SnapshotRow,
} from "@codewatch/graph";
import { formatError, snapshotVersionMismatchWarning } from "../utils/output.js";

export interface GraphCheckCommandOptions {
  db: string;
  config: string;
  snapshot?: string | number;
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
        ? resolveSnapshot(db, String(options.snapshot), "--snapshot")
        : (db.listSnapshots({ limit: 1 })[0] ?? null);
    if (!snapshot) {
      throw new Error(`No snapshot in ${options.db}`);
    }
    const baselineSnapshot = options.baseline
      ? resolveSnapshot(db, options.baseline, "--baseline", snapshot.id)
      : undefined;
    if (baselineSnapshot) {
      const warning = snapshotVersionMismatchWarning(
        snapshot.indexVersion,
        baselineSnapshot.indexVersion,
        "graph check --baseline",
      );
      if (warning) console.warn(warning);
    }
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
          "this is the first run. Bootstrap with `codewatch graph index <path>` and try again.",
      );
    }
    return previous;
  }
  if (/^\d+$/.test(spec)) {
    const snap = db.getSnapshot(Number(spec));
    if (!snap) throw new Error(`${flag}: no snapshot with id ${spec}`);
    return snap;
  }
  return resolveRefSnapshot(db, spec, flag);
}

/**
 * Map a ref name to a snapshot indexed at the ref's CURRENT commit. Falls back
 * to the newest snapshot for the ref (and warns) when the cached snapshot lags
 * the ref's real HEAD, so `--baseline main` never silently compares against a
 * months-old snapshot.
 */
function resolveRefSnapshot(
  db: GraphDatabase,
  ref: string,
  flag: string,
): SnapshotRow {
  const candidates = db.listSnapshots({ ref, limit: 50 });
  if (candidates.length === 0) {
    throw new Error(
      `${flag}: no snapshot found for ref "${ref}". ` +
        `Run \`codewatch graph index --ref ${ref} <path>\` against this DB first.`,
    );
  }
  const currentCommit = resolveGitRef(process.cwd(), ref);
  const { snapshot, stale } = selectRefSnapshot(candidates, currentCommit);
  if (stale) console.warn(staleBaselineWarning(ref, snapshot, currentCommit!));
  return snapshot;
}

export interface RefSnapshotSelection {
  snapshot: SnapshotRow;
  stale: boolean;
}

/**
 * Pure ref-to-snapshot picker. `snapshots` must be newest-first (as
 * listSnapshots returns). Prefers the snapshot indexed at `currentCommit`;
 * otherwise returns the newest and flags it stale. `currentCommit` null (git
 * could not resolve the ref) or a null-commitHash snapshot (pre-commit-tracking)
 * skip the staleness check.
 */
export function selectRefSnapshot(
  snapshots: readonly SnapshotRow[],
  currentCommit: string | null,
): RefSnapshotSelection {
  if (currentCommit) {
    const match = snapshots.find((s) => s.commitHash === currentCommit);
    if (match) return { snapshot: match, stale: false };
  }
  const latest = snapshots[0]!;
  const stale = currentCommit !== null && latest.commitHash !== null;
  return { snapshot: latest, stale };
}

function staleBaselineWarning(
  ref: string,
  snapshot: SnapshotRow,
  currentCommit: string,
): string {
  const cached = (snapshot.commitHash ?? "unknown").slice(0, 8);
  const head = currentCommit.slice(0, 8);
  return (
    `⚠ baseline "${ref}" resolves to snapshot ${snapshot.id} at commit ${cached} ` +
    `but ${ref} is currently at ${head} — the cached baseline is stale; re-index ` +
    `with \`codewatch graph index --ref ${ref}\` for an accurate comparison.`
  );
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
  return validateRules(parsed, {
    onWarn: (m) => console.warn(`${path}: ${m}`),
  });
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

export function registerGraphCheck(graphCmd: Command): void {
  graphCmd
    .command("check")
    .description(
      "Run rule checks against a snapshot (max-complexity, no-imports, …). Exits non-zero on violations.",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--config <path>", "Rules file (JSON)", "./.codewatch/check.json")
    .option(
      "--snapshot <ref-or-id>",
      "Snapshot to check: numeric id or ref name (default: latest)",
    )
    .option(
      "--baseline <ref-or-id>",
      "Suppress violations that already exist in this baseline snapshot",
    )
    .option("--json", "Output structured JSON")
    .action(
      async (options: {
        db: string;
        config: string;
        snapshot?: string;
        baseline?: string;
        json?: boolean;
      }) => {
        try {
          const result = await runGraphCheckCommand({
            db: options.db,
            config: options.config,
            snapshot: options.snapshot,
            baseline: options.baseline,
          });
          console.log(
            options.json
              ? formatGraphCheckJson(result)
              : formatGraphCheckText(result),
          );
          process.exitCode = result.result.passed ? 0 : 1;
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 2;
        }
      },
    );
}
