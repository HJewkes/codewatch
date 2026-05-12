import type { Command } from "commander";
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
import {
  buildExplanations,
  type RelevantAuthor,
  type RelevantVia,
} from "./graph-relevant-explain.js";
import {
  formatGraphRelevantJson,
  formatGraphRelevantText,
} from "./graph-relevant-format.js";

export { formatGraphRelevantJson, formatGraphRelevantText };

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
  explain?: boolean;
  repoRoot?: string;
}

export type { RelevantVia, RelevantAuthor };

export interface GraphRelevantRow {
  rank: number;
  nodeId: string;
  name: string;
  kind: string;
  role: NodeRole | null;
  parentId: string | null;
  score: number;
  via?: RelevantVia | null;
  topAuthor?: RelevantAuthor | null;
}

export interface GraphRelevantResult {
  snapshot: SnapshotRow;
  seeds: string[];
  rows: GraphRelevantRow[];
  iterations: number;
  converged: boolean;
  tokenBudget: number | null;
  tokenEstimate: number | null;
  explained: boolean;
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
    const filter: RowFilter = {
      nodeById,
      excluders: compilePatterns(options.exclude),
      excludedRoles: new Set(options.excludeRole ?? []),
      seedSet: new Set(seedIds),
      kindFilter: options.kind,
    };
    const filtered = pageRank.rows.filter((r) => keepRow(r, filter));

    const { rows, tokenEstimate } = sliceRows(filtered, nodeById, options);

    const annotated = options.explain
      ? buildExplanations(rows, edges, pageRank.rows, options.repoRoot).map(
          (e) => ({ ...e.row, via: e.via, topAuthor: e.topAuthor }),
        )
      : rows;

    return {
      snapshot,
      seeds: seedIds,
      rows: annotated,
      iterations: pageRank.iterations,
      converged: pageRank.converged,
      tokenBudget: options.maxTokens ?? null,
      tokenEstimate,
      explained: Boolean(options.explain),
    };
  } finally {
    db.close();
  }
}

interface RowFilter {
  nodeById: ReadonlyMap<string, GraphNode>;
  excluders: RegExp[];
  excludedRoles: ReadonlySet<string>;
  seedSet: ReadonlySet<string>;
  kindFilter: string | undefined;
}

function keepRow(
  r: { nodeId: string; score: number },
  f: RowFilter,
): boolean {
  if (f.seedSet.has(r.nodeId)) return false;
  const node = f.nodeById.get(r.nodeId);
  if (!node) return false;
  if (f.kindFilter && node.kind !== f.kindFilter) return false;
  if (matchesAny(r.nodeId, f.excluders)) return false;
  if (node.role && f.excludedRoles.has(node.role)) return false;
  return true;
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

function toRow(
  r: { nodeId: string; score: number },
  rank: number,
  nodeById: ReadonlyMap<string, GraphNode>,
): GraphRelevantRow {
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
}

function sliceByLimit(
  ranked: readonly { nodeId: string; score: number }[],
  nodeById: ReadonlyMap<string, GraphNode>,
  limit: number,
): GraphRelevantRow[] {
  return ranked.slice(0, limit).map((r, i) => toRow(r, i + 1, nodeById));
}

function sliceByTokenBudget(
  ranked: readonly { nodeId: string; score: number }[],
  nodeById: ReadonlyMap<string, GraphNode>,
  maxTokens: number,
): { rows: GraphRelevantRow[]; tokenEstimate: number } {
  const budgetChars = maxTokens * CHARS_PER_TOKEN;
  const rows: GraphRelevantRow[] = [];
  let usedChars = 0;
  for (const r of ranked) {
    const row = toRow(r, rows.length + 1, nodeById);
    const lineChars = row.nodeId.length + 12;
    if (rows.length > 0 && usedChars + lineChars > budgetChars) break;
    rows.push(row);
    usedChars += lineChars;
  }
  return { rows, tokenEstimate: Math.ceil(usedChars / CHARS_PER_TOKEN) };
}

function sliceRows(
  ranked: readonly { nodeId: string; score: number }[],
  nodeById: ReadonlyMap<string, GraphNode>,
  options: GraphRelevantCommandOptions,
): { rows: GraphRelevantRow[]; tokenEstimate: number | null } {
  if (options.maxTokens !== undefined) {
    return sliceByTokenBudget(ranked, nodeById, options.maxTokens);
  }
  return {
    rows: sliceByLimit(ranked, nodeById, options.limit ?? 30),
    tokenEstimate: null,
  };
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
    .option(
      "--explain",
      "Annotate each row with top inbound predecessor and top 30d author",
    )
    .option(
      "--repo-root <path>",
      "Repo root for git author lookup (default: detect from cwd)",
    )
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
        explain?: boolean;
        repoRoot?: string;
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
            explain: options.explain,
            repoRoot: options.repoRoot,
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
