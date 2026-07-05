import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createReadApi, READ_API_VERSION, type GraphReadApi, type ReadApiOptions } from "../read-api/index.js";

/**
 * C-81 — the codewatch **MCP server**: deterministic PULL tools an ingestor or
 * coding agent calls on demand, each a thin wrapper over the stable read API
 * (never the raw schema). No file reads on the client side — the server reads
 * the snapshot + repo and returns a self-contained record.
 */
export function buildMcpServer(api: GraphReadApi): McpServer {
  const server = new McpServer({ name: "codewatch", version: READ_API_VERSION });
  registerTools(server, api);
  return server;
}

/** Create a read API and serve it over stdio until the transport closes. */
export async function startMcpServer(options: ReadApiOptions): Promise<void> {
  const api = createReadApi(options);
  const server = buildMcpServer(api);
  server.server.onclose = () => api.close();
  await server.connect(new StdioServerTransport());
}

const TARGET = z
  .string()
  .describe("A file id, a `<file>#<symbol>` id, or a unique path suffix.");

function registerTools(server: McpServer, api: GraphReadApi): void {
  server.registerTool(
    "get_context",
    {
      description:
        "Full per-target context bundle: dossier + source chunk + resolved edges + coverage, plus deep AST (class members, param/return types). The client needs no file reads.",
      inputSchema: { target: TARGET, includeDeepAst: z.boolean().optional() },
    },
    ({ target, includeDeepAst }) =>
      run(() => api.getContext(target, { includeDeepAst: includeDeepAst ?? true })),
  );
  server.registerTool(
    "get_source",
    { description: "The exact source span (text + line range) for a symbol or file.", inputSchema: { target: TARGET } },
    ({ target }) => run(() => api.getSource(target)),
  );
  server.registerTool(
    "get_neighbors",
    {
      description: "Resolved graph edges for a target: callers (inbound), dependencies (outbound), and co-import coupling.",
      inputSchema: { target: TARGET },
    },
    ({ target }) => run(() => api.getNeighbors(target)),
  );
  server.registerTool(
    "search",
    {
      description: "Symbol/file lookup over the graph, ranked by match specificity.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().optional() },
    },
    ({ query, limit }) => run(() => api.search(query, limit)),
  );
}

/** Invoke a read-API call, projecting the result — or the error — as a tool result. */
function run(fn: () => unknown): CallToolResult {
  try {
    return json(fn());
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
  }
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
