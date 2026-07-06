import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer } from "./server.js";
import { createReadApi, type ReadApiOptions } from "../read-api/reader.js";

/**
 * Long-running codewatch MCP server over Streamable HTTP. Unlike the stdio server
 * (spawned fresh per client session — paying node boot + db open + handshake
 * before the client can use it, so a fast agent can commit to another tool before
 * codewatch is even connected), this stays resident: the read API / graph.db is
 * opened ONCE and shared across every session, so a client connect is just an
 * HTTP handshake to an already-warm process. Sessions are managed per the SDK's
 * canonical Streamable HTTP pattern (a session id issued on `initialize`, routed
 * on subsequent requests). Bind localhost only.
 */
export interface HttpMcpOptions extends ReadApiOptions {
  port: number;
  host?: string;
}

export async function startHttpMcpServer(options: HttpMcpOptions): Promise<void> {
  const api = createReadApi(options); // warm: opened once, shared by all sessions
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer((req, res) => {
    void handle(req, res, api, transports).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => httpServer.listen(options.port, host, resolve));
  process.stderr.write(
    `codewatch MCP HTTP server listening on http://${host}:${options.port}/mcp (warm; shared graph.db)\n`,
  );

  const shutdown = (): void => {
    httpServer.close();
    api.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  api: ReturnType<typeof createReadApi>,
  transports: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  if (!req.url || !req.url.startsWith("/mcp")) {
    res.writeHead(404).end();
    return;
  }
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport && isInitializeRequest(body)) {
      transport = newSession(api, transports);
    }
    if (!transport) {
      res.writeHead(400, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session; send an initialize request first." },
          id: null,
        }),
      );
      return;
    }
    await transport.handleRequest(req, res, body);
    return;
  }

  // GET (notification stream) / DELETE (session teardown) on an existing session.
  if ((req.method === "GET" || req.method === "DELETE") && sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res);
    return;
  }
  res.writeHead(400).end();
}

function newSession(
  api: ReturnType<typeof createReadApi>,
  transports: Map<string, StreamableHTTPServerTransport>,
): StreamableHTTPServerTransport {
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id: string) => {
      transports.set(id, transport);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) transports.delete(transport.sessionId);
  };
  // A fresh MCP server per session wraps the SAME warm read API (buildMcpServer
  // does NOT own the api lifecycle — the http server closes it on shutdown).
  void buildMcpServer(api).connect(transport);
  return transport;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : undefined;
}
