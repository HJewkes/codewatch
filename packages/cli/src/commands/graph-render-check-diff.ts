import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { dirname, resolve } from "node:path";
import chalk from "chalk";
import { renderHtml } from "@code-style/render";
import {
  diffCheckResults,
  openDatabase,
  runChecks,
  validateRules,
  type CheckRule,
  type GraphDatabase,
  type SnapshotRow,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";

export interface GraphRenderCheckDiffCommandOptions {
  db: string;
  config: string;
  from: string;
  to: string;
  out: string;
  title?: string;
  subtitle?: string;
  sizeBy?: string;
  colorBy?: string;
}

export interface GraphRenderCheckDiffResult {
  outPath: string;
  fromSnapshotId: number;
  toSnapshotId: number;
  newCount: number;
  resolvedCount: number;
  worsenedCount: number;
  improvedCount: number;
  sizeBytes: number;
  durationMs: number;
}

export async function runGraphRenderCheckDiffCommand(
  options: GraphRenderCheckDiffCommandOptions,
): Promise<GraphRenderCheckDiffResult> {
  const start = performance.now();
  const rules = await loadRulesFile(options.config);
  const db = openDatabase(options.db);
  try {
    const fromSnap = resolveSnapshot(db, options.from, "--from");
    const toSnap = resolveSnapshot(db, options.to, "--to");
    const diff = diffCheckResults(db, {
      fromSnapshotId: fromSnap.id,
      toSnapshotId: toSnap.id,
      rules,
    });
    const toCheck = runChecks(db, {
      snapshotId: toSnap.id,
      rules,
    });

    const html = await renderHtml(
      {
        snapshotId: toSnap.id,
        nodes: db.listNodes(toSnap.id),
        edges: db.listEdges(toSnap.id),
        metrics: db.listMetrics(toSnap.id),
        checkResult: toCheck,
        checkDiff: {
          fromSnapshot: fromSnap,
          toSnapshot: toSnap,
          resolved: diff.resolvedViolations,
          worsened: diff.worsened.map((u) => ({
            violation: u.to,
            before: u.from.value ?? 0,
            after: u.to.value ?? 0,
          })),
          improved: diff.improved.map((u) => ({
            violation: u.to,
            before: u.from.value ?? 0,
            after: u.to.value ?? 0,
          })),
          newCount: diff.newViolations.length,
          resolvedCount: diff.resolvedViolations.length,
        },
      },
      {
        title: options.title,
        subtitle: options.subtitle ?? `${fromSnap.ref} → ${toSnap.ref}`,
        sizeBy: options.sizeBy,
        colorBy: options.colorBy,
      },
    );

    const outPath = resolve(options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html, "utf8");
    const { size } = await stat(outPath);
    return {
      outPath,
      fromSnapshotId: fromSnap.id,
      toSnapshotId: toSnap.id,
      newCount: diff.newViolations.length,
      resolvedCount: diff.resolvedViolations.length,
      worsenedCount: diff.worsened.length,
      improvedCount: diff.improved.length,
      sizeBytes: size,
      durationMs: performance.now() - start,
    };
  } finally {
    db.close();
  }
}

async function loadRulesFile(path: string): Promise<readonly CheckRule[]> {
  const raw = await readFile(resolve(path), "utf8");
  return validateRules(JSON.parse(raw));
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
  if (!snap) throw new Error(`${flag}: no snapshot found for ref "${spec}"`);
  return snap;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatGraphRenderCheckDiffText(
  result: GraphRenderCheckDiffResult,
): string {
  const lines: string[] = [];
  lines.push(chalk.bold.underline(`Graph render-check-diff: ${result.outPath}`));
  lines.push(
    chalk.cyan(`Snapshots ${result.fromSnapshotId} → ${result.toSnapshotId}`),
  );
  lines.push("");
  lines.push(
    `${chalk.bold("Diff:")}   ` +
      `${chalk.red(`+${result.newCount}`)} new  ` +
      `${chalk.green(`-${result.resolvedCount}`)} resolved  ` +
      `${chalk.red(`↑${result.worsenedCount}`)} worsened  ` +
      `${chalk.green(`↓${result.improvedCount}`)} improved`,
  );
  lines.push(`${chalk.bold("Size:")}   ${formatBytes(result.sizeBytes)}`);
  lines.push("");
  lines.push(chalk.dim(`render ${result.durationMs.toFixed(0)}ms`));
  return lines.join("\n");
}

export function registerGraphRenderCheckDiff(graphCmd: Command): void {
  graphCmd
    .command("render-check-diff")
    .description("Render a check-diff: new/resolved/worsened/improved violations across two snapshots")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--config <path>", "Rules file (JSON)", "./.codewatch/check.json")
    .requiredOption("--from <ref-or-id>", "From-side snapshot")
    .requiredOption("--to <ref-or-id>", "To-side snapshot")
    .requiredOption("--out <path>", "Output HTML file")
    .option("--title <string>", "Heading shown in the HTML")
    .option("--subtitle <string>", "Small subheading (default: <from> → <to>)")
    .option("--size-by <metric>", "Vary node size by this metric")
    .option("--color-by <metric>", "Heat-map node fill by this metric")
    .action(
      async (options: GraphRenderCheckDiffCommandOptions) => {
        try {
          const result = await runGraphRenderCheckDiffCommand(options);
          console.log(formatGraphRenderCheckDiffText(result));
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
