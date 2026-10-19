import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGraphIndex } from "../../commands/graph-index-run.js";
import { createHttpMcpServer, type RunningHttpMcpServer } from "../http-server.js";

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
});

let dir: string;
let server: RunningHttpMcpServer;
let token: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "c214-http-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const one = 1;\n");
  const { dbPath } = await runGraphIndex({ rootDir: dir, ref: "test", computeChurn: false, detectRenames: false });
  server = await createHttpMcpServer({ db: dbPath, repoRoot: dir, port: 0, tokenPath: join(dir, "state", "mcp.token") });
  token = readFileSync(server.tokenPath, "utf-8").trim();
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function initialize(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: server.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(INITIALIZE);
  });
}

const loopbackHost = (): string => `127.0.0.1:${server.port}`;
const bearer = (): string => `Bearer ${token}`;

describe("HTTP MCP server — request guard", () => {
  it("refuses a DNS-rebinding Host even with the right token", async () => {
    const status = await initialize({ host: `evil.example:${server.port}`, authorization: bearer() });
    expect(status).toBe(403);
  });

  it("refuses a loopback hostname on a port other than the bound one", async () => {
    const status = await initialize({ host: `localhost:${server.port + 1}`, authorization: bearer() });
    expect(status).toBe(403);
  });

  it("refuses a foreign Origin even with a loopback Host and the right token", async () => {
    const status = await initialize({ host: loopbackHost(), origin: "http://evil.example", authorization: bearer() });
    expect(status).toBe(403);
  });

  it("refuses a request with no token", async () => {
    expect(await initialize({ host: loopbackHost() })).toBe(401);
  });

  it("refuses a request with the wrong token", async () => {
    expect(await initialize({ host: loopbackHost(), authorization: "Bearer not-the-token" })).toBe(401);
  });

  it("serves a loopback request that carries the token", async () => {
    expect(await initialize({ host: loopbackHost(), authorization: bearer() })).toBe(200);
  });

  it("serves [::1] and localhost Hosts and a loopback Origin", async () => {
    const origin = `http://localhost:${server.port}`;
    expect(await initialize({ host: `[::1]:${server.port}`, authorization: bearer() })).toBe(200);
    expect(await initialize({ host: `localhost:${server.port}`, origin, authorization: bearer() })).toBe(200);
  });
});

describe("HTTP MCP server — token file", () => {
  it("is created with mode 0600 and holds a long random token", () => {
    expect(statSync(server.tokenPath).mode & 0o777).toBe(0o600);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});
