import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import chalk from "chalk";
import { loadSnapshot, renderHtml } from "@code-style/render";

export interface GraphRenderCommandOptions {
  db: string;
  snapshot?: number;
  out: string;
  title?: string;
  subtitle?: string;
}

export interface GraphRenderResult {
  outPath: string;
  snapshotId: number;
  nodes: number;
  edges: number;
  sizeBytes: number;
  durationMs: number;
}

export async function runGraphRenderCommand(
  options: GraphRenderCommandOptions,
): Promise<GraphRenderResult> {
  const start = performance.now();
  const input = await loadSnapshot(options.db, options.snapshot);
  const html = await renderHtml(input, {
    title: options.title,
    subtitle: options.subtitle,
  });
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
  };
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
  lines.push("");
  lines.push(chalk.dim(`render ${result.durationMs.toFixed(0)}ms`));
  return lines.join("\n");
}
