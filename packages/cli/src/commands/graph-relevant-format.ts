import chalk from "chalk";
import { padLeft, padRight, visualWidth } from "../utils/table.js";
import type {
  GraphRelevantResult,
  GraphRelevantRow,
} from "./graph-relevant.js";

export function formatGraphRelevantText(result: GraphRelevantResult): string {
  if (result.tokenBudget !== null) return formatGraphRelevantTree(result);
  return formatGraphRelevantList(result);
}

export function formatGraphRelevantJson(result: GraphRelevantResult): string {
  return JSON.stringify(result, null, 2);
}

function formatScore(s: number): string {
  return s.toExponential(2);
}

function formatGraphRelevantList(result: GraphRelevantResult): string {
  const lines: string[] = [];
  const title = result.seeds.length > 0
    ? `Relevant to ${result.seeds.length === 1 ? result.seeds[0] : `${result.seeds.length} seeds`} — snap ${result.snapshot.id} (${result.snapshot.ref})`
    : `Most central nodes (uniform teleport) — snap ${result.snapshot.id} (${result.snapshot.ref})`;
  lines.push(chalk.bold.underline(title));
  if (result.seeds.length > 1) {
    lines.push(chalk.dim(`Seeds: ${result.seeds.join(", ")}`));
  }
  lines.push(
    chalk.dim(
      `iterations=${result.iterations}${result.converged ? "" : " (not converged)"}`,
    ),
  );
  lines.push("");

  if (result.rows.length === 0) {
    lines.push(chalk.dim("No nodes to rank."));
    return lines.join("\n");
  }

  const scoreStrings = result.rows.map((r) => formatScore(r.score));
  const scoreWidth = Math.max(...scoreStrings.map((s) => s.length), "score".length);
  const kindWidth = Math.max(
    ...result.rows.map((r) => r.kind.length),
    "kind".length,
  );

  lines.push(
    chalk.dim(
      `  ${padLeft("rank", 4)}  ${padLeft("score", scoreWidth)}  ${padRight("kind", kindWidth)}  id`,
    ),
  );
  for (const r of result.rows) {
    const scoreStr = formatScore(r.score);
    const scorePad = " ".repeat(Math.max(0, scoreWidth - visualWidth(scoreStr)));
    lines.push(
      `  ${padLeft(String(r.rank), 4)}  ${scorePad}${scoreStr}  ${padRight(r.kind, kindWidth)}  ${r.nodeId}`,
    );
    const explain = formatExplainSubline(r);
    if (explain) lines.push(chalk.dim(`        └ ${explain}`));
  }
  return lines.join("\n");
}

function formatExplainSubline(row: GraphRelevantRow): string | null {
  const parts: string[] = [];
  if (row.via) parts.push(`via ${row.via.nodeId}`);
  if (row.topAuthor) {
    parts.push(
      `top ${row.topAuthor.author} (${formatShare(row.topAuthor.share)})`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatShare(s: number): string {
  return `${Math.round(s * 100)}%`;
}

function formatGraphRelevantTree(result: GraphRelevantResult): string {
  const lines: string[] = [];
  const seedLabel =
    result.seeds.length === 0
      ? "(no seed)"
      : result.seeds.length === 1
        ? result.seeds[0]
        : `${result.seeds.length} seeds`;
  lines.push(`# Repo map relevant to: ${seedLabel}`);
  lines.push(
    `# budget=${result.tokenBudget} tokens, est=${result.tokenEstimate ?? 0}, ` +
      `snap=${result.snapshot.id}, iterations=${result.iterations}`,
  );
  lines.push("");

  if (result.rows.length === 0) {
    lines.push("(nothing relevant)");
    return lines.join("\n");
  }

  const grouped = new Map<string, GraphRelevantRow[]>();
  const groupOrder: string[] = [];
  for (const row of result.rows) {
    const key = groupKey(row);
    if (!grouped.has(key)) {
      grouped.set(key, []);
      groupOrder.push(key);
    }
    grouped.get(key)!.push(row);
  }

  for (const key of groupOrder) {
    lines.push(key);
    for (const row of grouped.get(key)!) {
      const explain = formatExplainSubline(row);
      const suffix = explain ? `    # ${explain}` : "";
      lines.push(`  ${row.nodeId}    ${formatScore(row.score)}${suffix}`);
    }
  }

  return lines.join("\n");
}

function groupKey(row: GraphRelevantRow): string {
  if (row.kind === "external") return "external";
  // Top-level segment is the package directory on typical monorepo layouts;
  // for unrooted nodes, fall back to the parent module.
  const firstSlash = row.nodeId.indexOf("/");
  if (firstSlash > 0) return row.nodeId.slice(0, firstSlash);
  return row.parentId ?? "(unknown)";
}
