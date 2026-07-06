import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGraphIndex } from "@codewatch/graph";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReadApi, READ_API_VERSION, type GraphReadApi } from "../reader.js";
import { buildMcpServer } from "../../mcp/server.js";

const A_SRC = ["/** Increments. */", "export function foo(a: number): number {", "  return a + 1;", "}"].join("\n");
const B_SRC = ['import { foo } from "./a.js";', "export const two = foo(1);"].join("\n");

const SYMBOL = "src/a.ts#foo";

let dir: string;
let dbPath: string;
let api: GraphReadApi;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "c81-read-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), A_SRC);
  writeFileSync(join(dir, "src", "b.ts"), B_SRC);
  const result = await runGraphIndex({ rootDir: dir, ref: "test", computeChurn: false, detectRenames: false });
  dbPath = result.dbPath;
  api = createReadApi({ db: dbPath, repoRoot: dir });
});

afterAll(() => {
  api.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("read API — versioned contract", () => {
  it("pins a semver version on the instance and the constant", () => {
    expect(api.version).toBe(READ_API_VERSION);
    expect(READ_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes exactly the four stable read functions", () => {
    for (const fn of ["getContext", "getSource", "getNeighbors", "search"] as const) {
      expect(typeof api[fn]).toBe("function");
    }
  });
});

describe("read API — the four reads over a fixture graph", () => {
  it("search ranks the symbol lookup", () => {
    const hits = api.search("foo").hits;
    expect(hits.some((h) => h.id === SYMBOL && h.kind === "symbol")).toBe(true);
  });

  it("getContext returns the C-80 bundle with a resolved target and source chunk", () => {
    const ctx = api.getContext(SYMBOL);
    expect(ctx.schemaVersion).toBe("2");
    expect(ctx.dossier.target.id).toBe(SYMBOL);
    expect(ctx.source.text).toContain("function foo");
    expect("deepAst" in ctx).toBe(false);
  });

  it("getContext computes deep AST on-pull when asked", () => {
    const ctx = api.getContext(SYMBOL, { includeDeepAst: true });
    expect(ctx.deepAst?.params).toEqual([{ name: "a", type: "number" }]);
    expect(ctx.deepAst?.returnType).toBe("number");
  });

  it("getSource projects the exact span text", () => {
    expect(api.getSource(SYMBOL).text).toContain("function foo");
  });

  it("getNeighbors resolves the inbound caller edge", () => {
    const edges = api.getNeighbors(SYMBOL);
    expect(edges.callers.some((e) => e.from === "src/b.ts")).toBe(true);
  });

  it("getContext (no deep AST) equals the bundle a fresh read yields", () => {
    expect(api.getContext(SYMBOL)).toEqual(api.getContext(SYMBOL));
  });
});

describe("MCP server — the four pull tools end to end (no client file reads)", () => {
  async function connectClient(): Promise<{
    client: Client;
    call: (n: string, a: Record<string, unknown>) => Promise<any>;
  }> {
    const server = buildMcpServer(api);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
      return JSON.parse(res.content[0]!.text);
    };
    return { client, call };
  }

  it("exposes the four tools", async () => {
    const { client } = await connectClient();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_context", "get_neighbors", "get_source", "search"]);
    await client.close();
  });

  it("get_context returns a full self-contained bundle with deep AST", async () => {
    const { client, call } = await connectClient();
    const ctx = await call("get_context", { target: SYMBOL });
    expect(ctx.schemaVersion).toBe("2");
    expect(ctx.source.text).toContain("function foo");
    expect(ctx.deepAst.returnType).toBe("number");
    await client.close();
  });

  it("get_source / get_neighbors / search resolve over MCP", async () => {
    const { client, call } = await connectClient();
    expect((await call("get_source", { target: SYMBOL })).text).toContain("function foo");
    expect((await call("get_neighbors", { target: SYMBOL })).callers.length).toBeGreaterThan(0);
    expect((await call("search", { query: "foo" })).hits.length).toBeGreaterThan(0);
    await client.close();
  });

  it("reports a resolution failure as a tool error, not a crash", async () => {
    const { client } = await connectClient();
    const res = (await client.callTool({ name: "get_source", arguments: { target: "does/not/exist.ts" } })) as {
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    await client.close();
  });
});
