import type { Command } from "commander";
import { formatError } from "../utils/output.js";

/**
 * C-81 — `graph mcp`: run codewatch as an MCP server (stdio) exposing the
 * deterministic pull tools (get_context / get_source / get_neighbors / search).
 * stdout is the MCP transport, so only errors go to stderr here.
 */
export function registerGraphMcp(graph: Command): void {
  graph
    .command("mcp")
    .description("Run codewatch as an MCP server (stdio) over a graph.db snapshot.")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--repo-root <path>", "Repo root for source + deep-AST reads (default: git toplevel)")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .action(async (options: { db: string; repoRoot?: string; snapshot?: string }) => {
      try {
        const { startMcpServer } = await import("../mcp/server.js");
        await startMcpServer({
          db: options.db,
          repoRoot: options.repoRoot,
          snapshot: options.snapshot ? Number(options.snapshot) : undefined,
        });
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
