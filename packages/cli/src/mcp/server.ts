import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createReadApi, READ_API_VERSION, type GraphReadApi, type ReadApiOptions } from "../read-api/reader.js";

/**
 * C-81 — the codewatch **MCP server**: deterministic PULL tools an ingestor or
 * coding agent calls on demand, each a thin wrapper over the stable read API
 * (never the raw schema). No file reads on the client side — the server reads
 * the snapshot + repo and returns a self-contained record.
 */
export function buildMcpServer(api: GraphReadApi): McpServer {
  const server = new McpServer(
    { name: "codewatch", version: READ_API_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, api);
  return server;
}

/**
 * Server-level guidance surfaced at initialize — the intended workflow, so an
 * agent reaches for the resolved-graph tools instead of treating `search` as a
 * grep. Guidance lives in the tool (here + the per-tool descriptions), never in
 * the caller's prompt.
 */
const SERVER_INSTRUCTIONS = [
  "codewatch serves a resolved dependency graph of this codebase. Unlike text",
  "search, its edges are resolved through re-export barrels and index files, so",
  "it finds who-uses-what and what-depends-on-what that grep cannot follow.",
  "",
  "Typical workflow for a code task:",
  "  1. `search` to turn a name into an exact id (a lookup step only — it returns",
  "     ids, not code or relationships).",
  "  2. `get_context` on that id to understand a symbol/file (signature, source,",
  "     what it depends on and what depends on it, tests) in one call.",
  "  3. `get_neighbors` to trace relationships — callers/importers (the blast",
  "     radius of a change) and dependencies — including through barrels.",
  "Before WRITING a new function or helper, call `find_similar` with the intent",
  "or a pseudo-signature — it surfaces existing symbols with similar capability",
  "so you extend or reuse instead of duplicating.",
  "Reach for these before manually reading files to discover how code connects:",
  "the graph already knows the resolved edges.",
].join("\n");

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
        "Understand a symbol or file in one call: its signature and docstring, source, the code it depends on AND the code that depends on it (resolved through re-export barrels), test coverage, and members (class fields, param/return types). Prefer this over reading files by hand when you need to know what a piece of code is and how it connects to the rest of the codebase.",
      inputSchema: { target: TARGET, includeDeepAst: z.boolean().optional() },
    },
    ({ target, includeDeepAst }) =>
      run(() => api.getContext(target, { includeDeepAst: includeDeepAst ?? true })),
  );
  server.registerTool(
    "get_source",
    { description: "The exact source text and line range for a symbol or file id.", inputSchema: { target: TARGET } },
    ({ target }) => run(() => api.getSource(target)),
  );
  server.registerTool(
    "get_neighbors",
    {
      description:
        "Trace what connects to a target: its callers/importers (what would break if you change it — the blast radius) and its dependencies (what it relies on). Edges are resolved through re-export barrels and index files, so this finds usage relationships that text search misses. Use for 'who uses X', 'what does X depend on', 'what's affected if I change X'.",
      inputSchema: { target: TARGET },
    },
    ({ target }) => run(() => api.getNeighbors(target)),
  );
  server.registerTool(
    "search",
    {
      description:
        "Find the exact id of a symbol or file by name or path when you don't already have it. A lookup step only: it returns candidate ids to pass to get_context / get_neighbors — NOT source code or relationships. To explore how code connects, use get_neighbors/get_context on the id, not repeated searches.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().optional() },
    },
    ({ query, limit }) => run(() => api.search(query, limit)),
  );
  server.registerTool(
    "find_similar",
    {
      description:
        "Before implementing a new function/helper/type, check whether a similar capability already exists in this repo. Pass the intent in natural language, a pseudo-signature, or both (e.g. \"formatDuration(ms: number): string -- render a duration as 1h30m\"); returns the top-K exported symbols ranked by semantic similarity of their signature+docstring, with locations. Candidates, not duplicate verdicts — inspect a promising hit with get_context before reusing it. Use at PLAN time, before writing code that might already exist.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().optional() },
    },
    async ({ query, limit }) => {
      try {
        return json(await api.findSimilar(query, limit));
      } catch (err) {
        return failure(err);
      }
    },
  );
}

/** Invoke a read-API call, projecting the result — or the error — as a tool result. */
function run(fn: () => unknown): CallToolResult {
  try {
    return json(fn());
  } catch (err) {
    return failure(err);
  }
}

function failure(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
