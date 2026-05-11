import type { Command } from "commander";
import chalk from "chalk";
import {
  compilePatterns,
  computeChangeCoupling,
  couplingFor,
  loadChurnEntries,
  matchesAny,
  openDatabase,
  type CoEditPair,
  type SnapshotRow,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";
import { padLeft, padRight } from "../utils/table.js";

export interface GraphCoupledCommandOptions {
  db: string;
  repoRoot: string;
  snapshot?: number;
  seed?: string;
  limit?: number;
  minCount?: number;
  windowDays?: number;
  largeCommitThreshold?: number;
  exclude?: string[];
  json?: boolean;
}

export interface GraphCoupledSeedRow {
  rank: number;
  partner: string;
  count: number;
  commits: string[];
}

export interface GraphCoupledTopRow {
  rank: number;
  fileA: string;
  fileB: string;
  count: number;
  commits: string[];
}

export type GraphCoupledRow = GraphCoupledSeedRow | GraphCoupledTopRow;

export interface GraphCoupledResult {
  snapshot: SnapshotRow | null;
  seed: string | null;
  windowDays: number;
  rows: GraphCoupledRow[];
  totalPairs: number;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 25;

export function runGraphCoupledCommand(
  options: GraphCoupledCommandOptions,
): GraphCoupledResult {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const snapshot = pickSnapshot(options);
  const knownFileIds = snapshot ? collectFileIds(options.db, snapshot.id) : undefined;

  const entries = loadChurnEntries({
    repoRoot: options.repoRoot,
    windowDays,
    knownFileIds,
  });
  if (entries === null) {
    throw new Error(
      `Couldn't read git history at ${options.repoRoot}. Is this a git repo?`,
    );
  }

  const pairs = computeChangeCoupling(entries, {
    minCount: options.minCount,
    largeCommitThreshold: options.largeCommitThreshold,
    knownFileIds,
  });

  const excluders = compilePatterns(options.exclude);
  const filtered = filterPairs(pairs, excluders);

  const limit = options.limit ?? DEFAULT_LIMIT;
  const seed = resolveSeed(options.seed, filtered);
  const rows = seed
    ? buildSeedRows(filtered, seed, limit)
    : buildTopRows(filtered, limit);

  return {
    snapshot,
    seed,
    windowDays,
    rows,
    totalPairs: filtered.length,
  };
}

function pickSnapshot(
  options: GraphCoupledCommandOptions,
): SnapshotRow | null {
  const db = openDatabase(options.db);
  try {
    if (options.snapshot !== undefined) return db.getSnapshot(options.snapshot);
    return db.listSnapshots({ limit: 1 })[0] ?? null;
  } finally {
    db.close();
  }
}

function collectFileIds(dbPath: string, snapshotId: number): Set<string> {
  const db = openDatabase(dbPath);
  try {
    const out = new Set<string>();
    for (const node of db.listNodes(snapshotId)) {
      if (node.kind === "file") out.add(node.id);
    }
    return out;
  } finally {
    db.close();
  }
}

function filterPairs(
  pairs: readonly CoEditPair[],
  excluders: readonly RegExp[],
): CoEditPair[] {
  if (excluders.length === 0) return [...pairs];
  return pairs.filter(
    (p) => !matchesAny(p.fileA, excluders) && !matchesAny(p.fileB, excluders),
  );
}

function resolveSeed(
  rawSeed: string | undefined,
  pairs: readonly CoEditPair[],
): string | null {
  if (!rawSeed) return null;
  const exact = pairs.some((p) => p.fileA === rawSeed || p.fileB === rawSeed);
  if (exact) return rawSeed;
  // No exact match — try fuzzy substring match against any seen file id.
  const seen = new Set<string>();
  for (const p of pairs) {
    seen.add(p.fileA);
    seen.add(p.fileB);
  }
  const matches = [...seen].filter((id) => id.includes(rawSeed));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous --seed "${rawSeed}" — matched ${matches.length} files. ` +
        `Disambiguate, e.g. "${matches[0]}".`,
    );
  }
  throw new Error(`No co-edited file matches --seed "${rawSeed}".`);
}

function buildSeedRows(
  pairs: readonly CoEditPair[],
  seed: string,
  limit: number,
): GraphCoupledSeedRow[] {
  return couplingFor(pairs, seed)
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, ...p }));
}

function buildTopRows(
  pairs: readonly CoEditPair[],
  limit: number,
): GraphCoupledTopRow[] {
  return pairs.slice(0, limit).map((p, i) => ({ rank: i + 1, ...p }));
}

function visualWidth(s: string): number {
  return s.replace(/\[[0-9;]*m/g, "").length;
}

export function formatGraphCoupledText(result: GraphCoupledResult): string {
  const header = result.seed
    ? `Co-edited with ${result.seed} — last ${result.windowDays}d`
    : `Top co-edited pairs — last ${result.windowDays}d`;
  const lines: string[] = [];
  lines.push(chalk.bold.underline(header));
  lines.push(
    chalk.dim(
      `${result.totalPairs} pairs total` +
        (result.snapshot ? `, snap ${result.snapshot.id} (${result.snapshot.ref})` : ""),
    ),
  );
  lines.push("");

  if (result.rows.length === 0) {
    lines.push(chalk.dim("No co-edits in window."));
    return lines.join("\n");
  }

  return lines.concat(renderRows(result)).join("\n");
}

function renderRows(result: GraphCoupledResult): string[] {
  return result.seed ? renderSeedRows(result.rows as GraphCoupledSeedRow[])
                     : renderTopRows(result.rows as GraphCoupledTopRow[]);
}

function renderSeedRows(rows: readonly GraphCoupledSeedRow[]): string[] {
  const countWidth = Math.max(
    ...rows.map((r) => String(r.count).length),
    "n".length,
  );
  const lines = [chalk.dim(`  ${padLeft("rank", 4)}  ${padLeft("n", countWidth)}  partner`)];
  for (const r of rows) {
    const n = padLeft(String(r.count), countWidth);
    const npad = " ".repeat(Math.max(0, countWidth - visualWidth(n)));
    lines.push(`  ${padLeft(String(r.rank), 4)}  ${npad}${n}  ${r.partner}`);
  }
  return lines;
}

function renderTopRows(rows: readonly GraphCoupledTopRow[]): string[] {
  const countWidth = Math.max(
    ...rows.map((r) => String(r.count).length),
    "n".length,
  );
  const aWidth = Math.max(...rows.map((r) => r.fileA.length), "fileA".length);
  const lines = [
    chalk.dim(
      `  ${padLeft("rank", 4)}  ${padLeft("n", countWidth)}  ${padRight("fileA", aWidth)}  fileB`,
    ),
  ];
  for (const r of rows) {
    const n = padLeft(String(r.count), countWidth);
    lines.push(
      `  ${padLeft(String(r.rank), 4)}  ${n}  ${padRight(r.fileA, aWidth)}  ${r.fileB}`,
    );
  }
  return lines;
}

export function formatGraphCoupledJson(result: GraphCoupledResult): string {
  return JSON.stringify(result, null, 2);
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

export function registerGraphCoupled(graphCmd: Command): void {
  graphCmd
    .command("coupled")
    .description(
      "Show files that change together (logical coupling via git co-edit frequency).",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--repo-root <path>", "Repo root (for git log)", ".")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option(
      "--seed <pattern>",
      "Show partners of this file id (exact or unique substring). Without --seed, lists top pairs globally.",
    )
    .option("--limit <n>", "Max rows to return (default 25)", "25")
    .option("--min-count <n>", "Skip pairs with fewer than n co-edits (default 2)")
    .option("--window-days <n>", "Days of git history to scan (default 30)")
    .option(
      "--large-commit-threshold <n>",
      "Skip commits touching more than n files (default 50)",
    )
    .option(
      "--exclude <pattern...>",
      "Exclude file paths matching this glob or substring (repeatable)",
    )
    .option("--json", "Output structured JSON")
    .action(
      (options: {
        db: string;
        repoRoot: string;
        snapshot?: string;
        seed?: string;
        limit?: string;
        minCount?: string;
        windowDays?: string;
        largeCommitThreshold?: string;
        exclude?: string[];
        json?: boolean;
      }) => {
        try {
          const result = runGraphCoupledCommand({
            db: options.db,
            repoRoot: options.repoRoot,
            snapshot: asNumber(options.snapshot),
            seed: options.seed,
            limit: asNumber(options.limit),
            minCount: asNumber(options.minCount),
            windowDays: asNumber(options.windowDays),
            largeCommitThreshold: asNumber(options.largeCommitThreshold),
            exclude: options.exclude,
          });
          console.log(
            options.json
              ? formatGraphCoupledJson(result)
              : formatGraphCoupledText(result),
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
