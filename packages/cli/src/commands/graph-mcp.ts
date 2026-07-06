import type { Command } from "commander";
import { formatError } from "../utils/output.js";

/**
 * C-81 — `graph mcp`: run codewatch as an MCP server exposing the deterministic
 * pull tools (get_context / get_source / get_neighbors / search). Defaults to
 * stdio (spawned per client session); `--http --port <n>` runs a long-running
 * Streamable HTTP server the client connects to instead — the graph.db is opened
 * once and stays warm across sessions, so a client connect is an instant HTTP
 * handshake rather than a cold node+db spawn. On stdio, stdout is the transport,
 * so only errors go to stderr here.
 */
export function registerGraphMcp(graph: Command): void {
  graph
    .command("mcp")
    .description("Run codewatch as an MCP server (stdio, or --http for a long-running server) over a graph.db snapshot.")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--repo-root <path>", "Repo root for source + deep-AST reads (default: git toplevel)")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--http", "Run a long-running Streamable HTTP server instead of stdio")
    .option("--port <n>", "Port for --http (default 7423)", "7423")
    .option("--host <host>", "Bind host for --http (default 127.0.0.1)", "127.0.0.1")
    .action(
      async (options: {
        db: string;
        repoRoot?: string;
        snapshot?: string;
        http?: boolean;
        port: string;
        host: string;
      }) => {
        try {
          const base = {
            db: options.db,
            repoRoot: options.repoRoot,
            snapshot: options.snapshot ? Number(options.snapshot) : undefined,
          };
          if (options.http) {
            const { startHttpMcpServer } = await import("../mcp/http-server.js");
            await startHttpMcpServer({ ...base, port: Number(options.port), host: options.host });
          } else {
            const { startMcpServer } = await import("../mcp/server.js");
            await startMcpServer(base);
          }
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
          process.exitCode = 1;
        }
      },
    );
}
