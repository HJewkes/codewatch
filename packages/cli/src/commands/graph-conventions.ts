import type { Command } from "commander";
import chalk from "chalk";
import {
  findConventions,
  getConventionMap,
  summarizeConventions,
  type CodeGraphStore,
  type ConventionOptions,
  type ConventionQueryResult,
  type SummarizeConventionsResult,
  type Summarizer,
} from "@titan-design/code-graph";
import { OllamaEmbedder, type Embedder } from "@titan-design/embed";
import {
  createClaudeSummarizer,
  DEFAULT_SUMMARY_MODEL,
} from "../utils/claude-summarizer.js";
import { openGraphStore } from "../utils/graph-store.js";
import { formatError } from "../utils/output.js";

export interface GraphConventionsOptions {
  db: string;
  snapshot?: number;
  /** "How does this repo do X?" — rank areas instead of printing the map. */
  query?: string;
  limit?: number;
  /** Coarse area-count target (default scales with repo size). */
  areas?: number;
  minSize?: number;
  /** Read stored summaries only; never call an LLM. */
  offline?: boolean;
  /** Claude model alias for the summarizer (default "sonnet"). */
  summaryModel?: string;
  /** Embedding model for --query (default nomic-embed-text). */
  embedModel?: string;
  ollamaUrl?: string;
  /** Test seams. */
  summarizer?: Summarizer;
  embedder?: Embedder;
}

export type GraphConventionsMapResult = SummarizeConventionsResult & {
  snapshotId: number;
};

async function withDb<T>(
  dbPath: string,
  snapshot: number | undefined,
  fn: (db: CodeGraphStore, snapshotId: number) => Promise<T>,
): Promise<T> {
  const db = openGraphStore(dbPath);
  try {
    const snap =
      snapshot !== undefined
        ? db.getSnapshot(snapshot)
        : (db.listSnapshots({ limit: 1 })[0] ?? null);
    if (!snap) throw new Error(`No snapshot found in ${dbPath}`);
    return await fn(db, snap.id);
  } finally {
    db.close();
  }
}

function conventionOpts(options: GraphConventionsOptions): ConventionOptions {
  return { targetCount: options.areas, minSize: options.minSize };
}

function summaryModelKey(options: GraphConventionsOptions): string {
  if (options.summarizer) return options.summarizer.model;
  return options.summaryModel
    ? `claude:${options.summaryModel}`
    : DEFAULT_SUMMARY_MODEL;
}

async function buildMap(
  db: CodeGraphStore,
  snapshotId: number,
  options: GraphConventionsOptions,
): Promise<SummarizeConventionsResult> {
  if (options.offline) {
    const map = getConventionMap(db, snapshotId, summaryModelKey(options), conventionOpts(options));
    return { ...map, newlySummarized: 0, reused: map.coverage.summarized };
  }
  const summarizer =
    options.summarizer ?? createClaudeSummarizer({ model: options.summaryModel });
  return summarizeConventions(db, snapshotId, summarizer, conventionOpts(options));
}

/** The convention map: partition + summaries (LLM only on cache misses). */
export function runGraphConventionsCommand(
  options: GraphConventionsOptions,
): Promise<GraphConventionsMapResult> {
  return withDb(options.db, options.snapshot, async (db, snapshotId) => {
    const map = await buildMap(db, snapshotId, options);
    return { ...map, snapshotId };
  });
}

/** Query mode: ensure summaries exist (unless offline), then rank by the query. */
export function runGraphConventionsQuery(
  options: GraphConventionsOptions & { query: string },
): Promise<ConventionQueryResult> {
  return withDb(options.db, options.snapshot, async (db, snapshotId) => {
    await buildMap(db, snapshotId, options);
    const embedder =
      options.embedder ??
      new OllamaEmbedder({ url: options.ollamaUrl, model: options.embedModel });
    return findConventions(db, snapshotId, options.query, embedder, summaryModelKey(options), {
      ...conventionOpts(options),
      limit: options.limit,
    });
  });
}

export function formatConventionMapText(result: GraphConventionsMapResult): string {
  const { coverage } = result;
  const lines = [
    chalk.bold.underline(
      `Convention map: snapshot ${result.snapshotId} (${result.model})`,
    ),
    chalk.dim(
      `${coverage.areas} areas covering ${coverage.grouped}/${coverage.files} files; ` +
        `${coverage.summarized} summarized (${result.newlySummarized} new, ${result.reused} cached)`,
    ),
    "",
  ];
  result.areas.forEach((area, i) => {
    lines.push(
      `${String(i + 1).padStart(2)}. ${chalk.bold(area.label)} ${chalk.dim(`(${area.size} files)`)}`,
    );
    lines.push(
      `    ${area.summary ?? chalk.dim("(no summary stored — rerun without --offline)")}`,
    );
  });
  return lines.join("\n");
}

export function formatConventionQueryText(result: ConventionQueryResult): string {
  const lines = [
    chalk.bold.underline(`Conventions: "${result.query}"`),
    chalk.dim(
      `${result.coverage.summarized}/${result.coverage.areas} areas summarized ` +
        `(${result.model}, query via ${result.embeddingModel})`,
    ),
    "",
  ];
  result.matches.forEach((m, i) => {
    lines.push(
      `${String(i + 1).padStart(2)}. ${chalk.bold(m.score.toFixed(3))}  ${chalk.cyan(m.label)} ${chalk.dim(`(${m.size} files)`)}`,
    );
    lines.push(`      ${m.summary}`);
    lines.push(chalk.dim(`      files: ${m.files.join(", ")}`));
  });
  lines.push("");
  lines.push(
    chalk.dim(
      "Areas are candidates for where related code lives — inspect files with `graph context` before placing new code.",
    ),
  );
  return lines.join("\n");
}

interface CliFlags {
  db: string;
  snapshot?: string;
  query?: string;
  limit?: string;
  areas?: string;
  minSize?: string;
  offline?: boolean;
  summaryModel?: string;
  embedModel?: string;
  ollamaUrl?: string;
  json?: boolean;
}

function parseFlags(flags: CliFlags): GraphConventionsOptions {
  const num = (v?: string): number | undefined =>
    v !== undefined ? Number(v) : undefined;
  return {
    db: flags.db,
    snapshot: num(flags.snapshot),
    query: flags.query,
    limit: num(flags.limit),
    areas: num(flags.areas),
    minSize: num(flags.minSize),
    offline: flags.offline,
    summaryModel: flags.summaryModel,
    embedModel: flags.embedModel,
    ollamaUrl: flags.ollamaUrl,
  };
}

export function registerGraphConventions(graphCmd: Command): void {
  graphCmd
    .command("conventions")
    .description(
      "Capability-altitude convention map: coarse areas of the resolved file graph, each with an LLM summary of what it does and how (\"how does this repo do X / where does new code belong\"). Summaries are content-addressed — only structurally changed areas cost an LLM call. --query ranks areas against a question.",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--query <text>", 'Rank areas against a "how does this repo do X" question')
    .option("--limit <n>", "Matches to return in query mode (default 3)")
    .option("--areas <n>", "Coarse area-count target (default: scales with repo size)")
    .option("--min-size <n>", "Smallest area to keep (default 3 files)")
    .option("--offline", "Read stored summaries only; never call an LLM")
    .option("--summary-model <alias>", "Claude model alias for summaries (default sonnet)")
    .option("--embed-model <name>", "Embedding model for --query (default nomic-embed-text)")
    .option("--ollama-url <url>", "Ollama base URL (default: http://localhost:11434)")
    .option("--json", "Output structured JSON")
    .action(async (flags: CliFlags) => {
      try {
        const options = parseFlags(flags);
        if (options.query) {
          const result = await runGraphConventionsQuery(
            options as GraphConventionsOptions & { query: string },
          );
          console.log(
            flags.json ? JSON.stringify(result, null, 2) : formatConventionQueryText(result),
          );
          return;
        }
        const result = await runGraphConventionsCommand(options);
        console.log(
          flags.json ? JSON.stringify(result, null, 2) : formatConventionMapText(result),
        );
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
