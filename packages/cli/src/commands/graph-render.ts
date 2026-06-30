import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import chalk from "chalk";
import { loadSnapshot, renderHtml } from "@code-style/render";
import {
  openDatabase,
  runChecks,
  validateRules,
  type CheckResult,
  type CheckRule,
} from "@code-style/graph";

export interface GraphRenderCommandOptions {
  db: string;
  snapshot?: number;
  out: string;
  title?: string;
  subtitle?: string;
  sizeBy?: string;
  colorBy?: string;
  check?: string;
  baseline?: string;
}

export interface GraphRenderResult {
  outPath: string;
  snapshotId: number;
  nodes: number;
  edges: number;
  sizeBytes: number;
  durationMs: number;
  violations?: number;
  passed?: boolean;
}

export async function runGraphRenderCommand(
  options: GraphRenderCommandOptions,
): Promise<GraphRenderResult> {
  const start = performance.now();
  const input = await loadSnapshot(options.db, options.snapshot);
  const checkResult = options.check
    ? await runCheckAgainstSnapshot(
        options.db,
        input.snapshotId,
        options.check,
        options.baseline,
      )
    : undefined;
  const html = await renderHtml(
    { ...input, checkResult },
    {
      title: options.title,
      subtitle: options.subtitle,
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
    snapshotId: input.snapshotId,
    nodes: input.nodes.length,
    edges: input.edges.length,
    sizeBytes: size,
    durationMs: performance.now() - start,
    ...(checkResult
      ? { violations: checkResult.violations.length, passed: checkResult.passed }
      : {}),
  };
}

async function runCheckAgainstSnapshot(
  dbPath: string,
  snapshotId: number,
  configPath: string,
  baselineSpec: string | undefined,
): Promise<CheckResult> {
  const rules = await loadRulesFile(configPath);
  const db = openDatabase(dbPath);
  try {
    const baselineId = baselineSpec
      ? resolveBaselineId(db, baselineSpec, snapshotId)
      : undefined;
    return runChecks(db, {
      snapshotId,
      rules,
      baselineSnapshotId: baselineId,
    });
  } finally {
    db.close();
  }
}

async function loadRulesFile(path: string): Promise<readonly CheckRule[]> {
  const raw = await readFile(resolve(path), "utf8");
  return validateRules(JSON.parse(raw), {
    onWarn: (m) => console.warn(`${path}: ${m}`),
  });
}

function resolveBaselineId(
  db: ReturnType<typeof openDatabase>,
  spec: string,
  headSnapshotId: number,
): number {
  if (/^\d+$/.test(spec)) {
    const snap = db.getSnapshot(Number(spec));
    if (!snap) throw new Error(`--baseline: no snapshot with id ${spec}`);
    return snap.id;
  }
  if (spec === "previous") {
    const recent = db.listSnapshots({ limit: 5 });
    const previous = recent.find((s) => s.id !== headSnapshotId);
    if (!previous) {
      throw new Error(
        `--baseline: "previous" requires at least one prior snapshot`,
      );
    }
    return previous.id;
  }
  const snap = db.getLatestSnapshotByRef(spec);
  if (!snap) {
    throw new Error(`--baseline: no snapshot found for ref "${spec}"`);
  }
  return snap.id;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatGraphRenderText(result: GraphRenderResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold.underline(`Graph render: ${result.outPath}`));
  lines.push(chalk.cyan(`Snapshot ${result.snapshotId}`));
  lines.push("");
  lines.push(`${chalk.bold("Nodes:")}  ${result.nodes}`);
  lines.push(`${chalk.bold("Edges:")}  ${result.edges}`);
  lines.push(`${chalk.bold("Size:")}   ${formatBytes(result.sizeBytes)}`);
  if (result.violations !== undefined) {
    const status = result.passed ? chalk.green("✓ pass") : chalk.red("✗ fail");
    lines.push(
      `${chalk.bold("Check:")}  ${result.violations} violation(s) — ${status}`,
    );
  }
  lines.push("");
  lines.push(chalk.dim(`render ${result.durationMs.toFixed(0)}ms`));
  return lines.join("\n");
}
