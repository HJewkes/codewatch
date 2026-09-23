import type { Command } from "commander";
import chalk from "chalk";
import {
  embedSnapshot,
  type EmbedSnapshotResult,
} from "@titan-design/code-graph";
import { OllamaEmbedder, type Embedder } from "@titan-design/embed";
import { formatError } from "../utils/output.js";
import { openGraphStore } from "../utils/graph-store.js";

export interface GraphEmbedOptions {
  db: string;
  snapshot?: number;
  model?: string;
  ollamaUrl?: string;
  /** Test seam: overrides the ollama-backed embedder. */
  embedder?: Embedder;
}

export type GraphEmbedResult = EmbedSnapshotResult & { snapshotId: number };

export async function runGraphEmbedCommand(
  options: GraphEmbedOptions,
): Promise<GraphEmbedResult> {
  const db = openGraphStore(options.db);
  try {
    const snap =
      options.snapshot !== undefined
        ? db.getSnapshot(options.snapshot)
        : (db.listSnapshots({ limit: 1 })[0] ?? null);
    if (!snap) throw new Error(`No snapshot found in ${options.db}`);
    const embedder =
      options.embedder ??
      new OllamaEmbedder({ url: options.ollamaUrl, model: options.model });
    const result = await embedSnapshot(db, snap.id, embedder);
    return { ...result, snapshotId: snap.id };
  } finally {
    db.close();
  }
}

export function formatGraphEmbedText(result: GraphEmbedResult): string {
  const purposePct =
    result.symbols > 0
      ? Math.round((100 * result.withPurpose) / result.symbols)
      : 0;
  const lines = [
    chalk.bold.underline(
      `Capability embeddings: snapshot ${result.snapshotId} (${result.model})`,
    ),
    `${chalk.bold("Symbols:")}  ${result.symbols} exported with signatures`,
    `${chalk.bold("Embedded:")} ${result.embedded}  ${chalk.dim(
      `(${result.newlyEmbedded} new texts, ${result.reused} reused)`,
    )}`,
    `${chalk.bold("Purpose:")}  ${result.withPurpose} with docstrings (${purposePct}%) ${chalk.dim(
      "— similarity recall is strongest where purpose text exists",
    )}`,
  ];
  return lines.join("\n");
}

export function registerGraphEmbed(graphCmd: Command): void {
  graphCmd
    .command("embed")
    .description(
      "Precompute capability embeddings (signature + docstring) for a snapshot's exported symbols, powering `graph similar`. Needs a local ollama; only new/changed texts are embedded.",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--model <name>", "Embedding model (default: nomic-embed-text)")
    .option("--ollama-url <url>", "Ollama base URL (default: http://localhost:11434)")
    .option("--json", "Output structured JSON")
    .action(
      async (options: {
        db: string;
        snapshot?: string;
        model?: string;
        ollamaUrl?: string;
        json?: boolean;
      }) => {
        try {
          const result = await runGraphEmbedCommand({
            db: options.db,
            snapshot:
              options.snapshot !== undefined ? Number(options.snapshot) : undefined,
            model: options.model,
            ollamaUrl: options.ollamaUrl,
          });
          console.log(
            options.json
              ? JSON.stringify(result, null, 2)
              : formatGraphEmbedText(result),
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
