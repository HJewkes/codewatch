import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  embedSnapshot,
  listEmbeddableSymbols,
  openCodeGraph,
  summarizeConventions,
  type Summarizer,
} from "@titan-design/code-graph";
import type { Embedder } from "@titan-design/embed";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReadApi, READ_API_VERSION, type GraphReadApi } from "../reader.js";
import { buildMcpServer } from "../../mcp/server.js";
import { runGraphIndex } from "../../commands/graph-index-run.js";

const A_SRC = ["/** Increments. */", "export function foo(a: number): number {", "  return a + 1;", "}"].join("\n");
const B_SRC = ['import { foo } from "./a.js";', "export const two = foo(1);"].join("\n");
const C_SRC = ['import { foo } from "./a.js";', "export const three = foo(2);"].join("\n");

const SYMBOL = "src/a.ts#foo";

/** Canned summarizer keyed by the area label line, so ranking is testable. */
const fakeSummarizer: Summarizer = {
  model: "fake-summary",
  summarize: (prompt) => {
    const label = prompt.match(/^Capability area: (.+)$/m)?.[1] ?? "?";
    return Promise.resolve(`Summary of ${label}.`);
  },
};

/** Deterministic hash-based embedder: identical text → identical vector. */
const fakeEmbedder: Embedder = {
  model: "fake-model",
  dimensions: 8,
  embed: (texts: string[]) =>
    Promise.resolve(
      texts.map((t) => {
        const bytes = createHash("sha256").update(t, "utf8").digest();
        return Array.from(bytes.subarray(0, 8), (byte) => byte / 255 - 0.5);
      }),
    ),
};

let dir: string;
let dbPath: string;
let api: GraphReadApi;
let fooEmbedText: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "c81-read-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), A_SRC);
  writeFileSync(join(dir, "src", "b.ts"), B_SRC);
  writeFileSync(join(dir, "src", "c.ts"), C_SRC);
  const result = await runGraphIndex({ rootDir: dir, ref: "test", computeChurn: false, detectRenames: false });
  dbPath = result.dbPath;
  const db = openCodeGraph(dbPath);
  await embedSnapshot(db, result.snapshotId, fakeEmbedder);
  await summarizeConventions(db, result.snapshotId, fakeSummarizer);
  fooEmbedText = listEmbeddableSymbols(db, result.snapshotId).find((s) => s.id === SYMBOL)!.text;
  db.close();
  api = createReadApi({ db: dbPath, repoRoot: dir, embedder: fakeEmbedder, summaryModel: fakeSummarizer.model });
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

  it("exposes the stable read functions", () => {
    for (const fn of ["getContext", "getSource", "getNeighbors", "search", "findSimilar", "getConventions", "findConventions"] as const) {
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

  it("getConventions returns the precomputed convention map", () => {
    const map = api.getConventions();
    expect(map.coverage.areas).toBe(1);
    expect(map.areas[0]!.label).toBe("src");
    expect(map.areas[0]!.summary).toBe("Summary of src.");
    expect(map.areas[0]!.files).toHaveLength(3);
  });

  it("findConventions ranks areas against a question", async () => {
    const result = await api.findConventions("Summary of src.", 1);
    expect(result.matches[0]!.label).toBe("src");
    expect(result.matches[0]!.score).toBeCloseTo(1, 5);
  });

  it("findSimilar ranks an exact capability text at ~1.0 with coverage", async () => {
    const result = await api.findSimilar(fooEmbedText);
    expect(result.coverage.embedded).toBeGreaterThan(0);
    expect(result.candidates[0]!.id).toBe(SYMBOL);
    expect(result.candidates[0]!.score).toBeCloseTo(1, 5);
    expect(result.candidates[0]!.signature).toContain("a: number");
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

  it("exposes the pull tools", async () => {
    const { client } = await connectClient();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["find_similar", "get_context", "get_conventions", "get_neighbors", "get_source", "search"]);
    await client.close();
  });

  it("find_similar returns ranked capability candidates over MCP", async () => {
    const { client, call } = await connectClient();
    const result = await call("find_similar", { query: fooEmbedText, limit: 3 });
    expect(result.candidates[0].id).toBe(SYMBOL);
    expect(result.coverage.symbols).toBeGreaterThan(0);
    await client.close();
  });

  it("get_conventions returns the map, and ranks with a query", async () => {
    const { client, call } = await connectClient();
    const map = await call("get_conventions", {});
    expect(map.areas[0].summary).toBe("Summary of src.");
    const ranked = await call("get_conventions", { query: "Summary of src.", limit: 1 });
    expect(ranked.matches[0].label).toBe("src");
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
