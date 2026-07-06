import type { Command } from "commander";
import chalk from "chalk";
import {
  findSimilarCapability,
  openDatabase,
  type Embedder,
  type SimilarResult,
} from "@codewatch/graph";
import { createOllamaEmbedder } from "../utils/ollama-embedder.js";
import { formatError } from "../utils/output.js";

export interface GraphSimilarOptions {
  db: string;
  query: string;
  snapshot?: number;
  limit?: number;
  model?: string;
  ollamaUrl?: string;
  /** Test seam: overrides the ollama-backed embedder. */
  embedder?: Embedder;
}

export async function runGraphSimilarCommand(
  options: GraphSimilarOptions,
): Promise<SimilarResult> {
  const db = openDatabase(options.db);
  try {
    const snap =
      options.snapshot !== undefined
        ? db.getSnapshot(options.snapshot)
        : (db.listSnapshots({ limit: 1 })[0] ?? null);
    if (!snap) throw new Error(`No snapshot found in ${options.db}`);
    const embedder =
      options.embedder ??
      createOllamaEmbedder({ baseUrl: options.ollamaUrl, model: options.model });
    return await findSimilarCapability(db, snap.id, options.query, embedder, {
      limit: options.limit,
    });
  } finally {
    db.close();
  }
}

export function formatGraphSimilarText(result: SimilarResult): string {
  const { coverage } = result;
  const purposePct =
    coverage.symbols > 0
      ? Math.round((100 * coverage.withPurpose) / coverage.symbols)
      : 0;
  const lines = [
    chalk.bold.underline(`Similar capability candidates: "${result.query}"`),
    chalk.dim(
      `${coverage.embedded}/${coverage.symbols} exported symbols embedded; ` +
        `${purposePct}% carry docstring purpose (recall is strongest there)`,
    ),
    "",
  ];
  if (result.candidates.length === 0) {
    lines.push("No candidates found.");
    return lines.join("\n");
  }
  result.candidates.forEach((c, i) => {
    lines.push(
      `${String(i + 1).padStart(2)}. ${chalk.bold(c.score.toFixed(3))}  ${chalk.cyan(c.id)}`,
    );
    lines.push(`      ${c.signature}${c.purpose ? chalk.dim(` — ${c.purpose}`) : ""}`);
  });
  lines.push("");
  lines.push(
    chalk.dim(
      "Candidates, not verdicts — read the source before treating one as an existing implementation.",
    ),
  );
  return lines.join("\n");
}

export function registerGraphSimilar(graphCmd: Command): void {
  graphCmd
    .command("similar <query>")
    .description(
      "Before writing a new function, check whether the capability already exists: rank exported symbols by semantic similarity to an intent or pseudo-signature (e.g. \"formatDuration(ms: number): string -- render a duration as 1h30m\"). Candidates, not verdicts. Needs `graph embed` first.",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("-k, --limit <n>", "Number of candidates to return", "10")
    .option("--model <name>", "Embedding model (default: nomic-embed-text)")
    .option("--ollama-url <url>", "Ollama base URL (default: http://localhost:11434)")
    .option("--json", "Output structured JSON")
    .action(
      async (
        query: string,
        options: {
          db: string;
          snapshot?: string;
          limit: string;
          model?: string;
          ollamaUrl?: string;
          json?: boolean;
        },
      ) => {
        try {
          const result = await runGraphSimilarCommand({
            db: options.db,
            query,
            snapshot:
              options.snapshot !== undefined ? Number(options.snapshot) : undefined,
            limit: Number(options.limit),
            model: options.model,
            ollamaUrl: options.ollamaUrl,
          });
          console.log(
            options.json
              ? JSON.stringify(result, null, 2)
              : formatGraphSimilarText(result),
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
