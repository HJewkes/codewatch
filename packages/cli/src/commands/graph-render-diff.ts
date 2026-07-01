import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import chalk from "chalk";
import { loadDiff, renderHtml } from "@codewatch/render";

export interface GraphRenderDiffCommandOptions {
  db: string;
  from: string;
  to: string;
  out: string;
  title?: string;
  subtitle?: string;
  sizeBy?: string;
  colorBy?: string;
}

export interface GraphRenderDiffResult {
  outPath: string;
  fromSnapshotId: number;
  toSnapshotId: number;
  nodes: number;
  edges: number;
  added: number;
  removed: number;
  renamed: number;
  sizeBytes: number;
  durationMs: number;
}

export async function runGraphRenderDiffCommand(
  options: GraphRenderDiffCommandOptions,
): Promise<GraphRenderDiffResult> {
  const start = performance.now();
  const input = await loadDiff({
    dbPath: options.db,
    from: options.from,
    to: options.to,
  });
  const html = await renderHtml(input, {
    title: options.title,
    subtitle: options.subtitle,
    sizeBy: options.sizeBy,
    colorBy: options.colorBy,
  });
  const outPath = resolve(options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  const { size } = await stat(outPath);
  const summary = input.diff!.summary;
  return {
    outPath,
    fromSnapshotId: summary.fromSnapshotId,
    toSnapshotId: summary.toSnapshotId,
    nodes: input.nodes.length,
    edges: input.edges.length,
    added: summary.addedNodes,
    removed: summary.removedNodes,
    renamed: summary.renamedNodes,
    sizeBytes: size,
    durationMs: performance.now() - start,
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatGraphRenderDiffText(
  result: GraphRenderDiffResult,
): string {
  const lines: string[] = [];
  lines.push(chalk.bold.underline(`Graph diff render: ${result.outPath}`));
  lines.push(
    chalk.cyan(
      `Snapshots ${result.fromSnapshotId} → ${result.toSnapshotId}`,
    ),
  );
  lines.push("");
  lines.push(`${chalk.bold("Nodes:")}  ${result.nodes}`);
  lines.push(`${chalk.bold("Edges:")}  ${result.edges}`);
  lines.push(
    `${chalk.bold("Diff:")}   ` +
      `${chalk.green(`+${result.added}`)} added  ` +
      `${chalk.red(`-${result.removed}`)} removed  ` +
      `${chalk.cyan(`~${result.renamed}`)} renamed`,
  );
  lines.push(`${chalk.bold("Size:")}   ${formatBytes(result.sizeBytes)}`);
  lines.push("");
  lines.push(chalk.dim(`render ${result.durationMs.toFixed(0)}ms`));
  return lines.join("\n");
}
