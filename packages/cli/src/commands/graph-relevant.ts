import type { Command } from "commander";
import chalk from "chalk";
import {
  compilePatterns,
  computePageRank,
  matchesAny,
  openDatabase,
  type GraphNode,
  type NodeRole,
  type SnapshotRow,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";
import { padLeft, padRight, visualWidth } from "../utils/table.js";

export interface GraphRelevantCommandOptions {
  db: string;
  snapshot?: number;
  seed?: string[];
  limit?: number;
  maxTokens?: number;
  kind?: string;
  exclude?: string[];
  excludeRole?: string[];
  damping?: number;
  json?: boolean;
}

export interface GraphRelevantRow {
  rank: number;
  nodeId: string;
  name: string;
  kind: string;
  role: NodeRole | null;
  parentId: string | null;
  score: number;
}

export interface GraphRelevantResult {
  snapshot: SnapshotRow;
  seeds: string[];
  rows: GraphRelevantRow[];
  iterations: number;
  converged: boolean;
  tokenBudget: number | null;
  tokenEstimate: number | null;
}

const CHARS_PER_TOKEN = 4;

export function runGraphRelevantCommand(
  options: GraphRelevantCommandOptions,
): GraphRelevantResult {
  const db = openDatabase(options.db);
  try {
    const snapshot =
      options.snapshot !== undefined
        ? db.getSnapshot(options.snapshot)
        : (db.listSnapshots({ limit: 1 })[0] ?? null);
    if (!snapshot) throw new Error(`No snapshot in ${options.db}`);

    const nodes = db.listNodes(snapshot.id);
    const edges = db.listEdges(snapshot.id);

    const seedIds = resolveSeeds(nodes, options.seed);
    const personalization =
      seedIds.length > 0
        ? new Map(seedIds.map((id) => [id, 1] as const))
        : undefined;

    const pageRank = computePageRank(nodes, edges, {
      personalization,
      damping: options.damping,
    });

    const nodeById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
    const excluders = compilePatterns(options.exclude);
    const excludedRoles = new Set(options.excludeRole ?? []);
    const seedSet = new Set(seedIds);

    const filtered = pageRank.rows.filter((r) => {
      const node = nodeById.get(r.nodeId);
      if (!node) return false;
      if (seedSet.has(r.nodeId)) return false;
      if (options.kind && node.kind !== options.kind) return false;
      if (excluders.length > 0 && matchesAny(r.nodeId, excluders)) return false;
      if (node.role && excludedRoles.has(node.role)) return false;
      return true;
    });

    const { rows, tokenEstimate } = sliceRows(filtered, nodeById, options);

    return {
      snapshot,
      seeds: seedIds,
      rows,
      iterations: pageRank.iterations,
      converged: pageRank.converged,
      tokenBudget: options.maxTokens ?? null,
      tokenEstimate,
    };
  } finally {
    db.close();
  }
}

function resolveSeeds(
  nodes: readonly GraphNode[],
  seedPatterns: readonly string[] | undefined,
): string[] {
  if (!seedPatterns || seedPatterns.length === 0) return [];
  const compiled = compilePatterns(seedPatterns);
  const matched = nodes
    .filter((n) => matchesAny(n.id, compiled))
    .map((n) => n.id);
  if (matched.length === 0) {
    throw new Error(
      `No nodes matched seed patterns: ${seedPatterns.join(", ")}`,
    );
  }
  return matched;
}

function sliceRows(
  ranked: readonly { nodeId: string; score: number }[],
  nodeById: ReadonlyMap<string, GraphNode>,
  options: GraphRelevantCommandOptions,
): { rows: GraphRelevantRow[]; tokenEstimate: number | null } {
  const toRow = (
    r: { nodeId: string; score: number },
    rank: number,
  ): GraphRelevantRow => {
    const node = nodeById.get(r.nodeId)!;
    return {
      rank,
      nodeId: r.nodeId,
      name: node.name,
      kind: node.kind,
      role: (node.role ?? null) as NodeRole | null,
      parentId: node.parentId ?? null,
      score: r.score,
    };
  };

  if (options.maxTokens !== undefined) {
    const budgetChars = options.maxTokens * CHARS_PER_TOKEN;
    const rows: GraphRelevantRow[] = [];
    let usedChars = 0;
    for (const r of ranked) {
      const row = toRow(r, rows.length + 1);
      const lineChars = row.nodeId.length + 12;
      if (rows.length > 0 && usedChars + lineChars > budgetChars) break;
      rows.push(row);
      usedChars += lineChars;
    }
    return { rows, tokenEstimate: Math.ceil(usedChars / CHARS_PER_TOKEN) };
  }

  const desired = options.limit ?? 30;
  const rows = ranked.slice(0, desired).map((r, i) => toRow(r, i + 1));
  return { rows, tokenEstimate: null };
}

function formatScore(s: number): string {
  return s.toExponential(2);
}

export function formatGraphRelevantText(result: GraphRelevantResult): string {
  if (result.tokenBudget !== null) return formatGraphRelevantTree(result);
  return formatGraphRelevantList(result);
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
  }
  return lines.join("\n");
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
      lines.push(`  ${row.nodeId}    ${formatScore(row.score)}`);
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

export function formatGraphRelevantJson(result: GraphRelevantResult): string {
  return JSON.stringify(result, null, 2);
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

export function registerGraphRelevant(graphCmd: Command): void {
  graphCmd
    .command("relevant")
    .description(
      "Rank nodes by personalized PageRank, optionally seeded with paths the LLM is editing (Aider-style repo map).",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option(
      "--seed <pattern...>",
      "Seed node id, substring, or glob (repeatable). Without a seed, ranks by uniform-teleport centrality.",
    )
    .option("--limit <n>", "Max rows to return (default 30)", "30")
    .option(
      "--max-tokens <n>",
      "Token budget for LLM-consumable tree output (overrides --limit)",
    )
    .option(
      "--kind <kind>",
      "Filter to one node kind (file, module, package, external)",
    )
    .option(
      "--exclude <pattern...>",
      "Exclude node ids matching this glob or substring (repeatable)",
    )
    .option(
      "--exclude-role <role...>",
      "Exclude nodes with this role (test, fixture, barrel, types, config; repeatable)",
    )
    .option("--damping <n>", "PageRank damping factor (0..1; default 0.85)")
    .option("--json", "Output structured JSON")
    .action(
      (options: {
        db: string;
        snapshot?: string;
        seed?: string[];
        limit?: string;
        maxTokens?: string;
        kind?: string;
        exclude?: string[];
        excludeRole?: string[];
        damping?: string;
        json?: boolean;
      }) => {
        try {
          const result = runGraphRelevantCommand({
            db: options.db,
            snapshot: asNumber(options.snapshot),
            seed: options.seed,
            limit: asNumber(options.limit),
            maxTokens: asNumber(options.maxTokens),
            kind: options.kind,
            exclude: options.exclude,
            excludeRole: options.excludeRole,
            damping: asNumber(options.damping),
          });
          console.log(
            options.json
              ? formatGraphRelevantJson(result)
              : formatGraphRelevantText(result),
          );
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
