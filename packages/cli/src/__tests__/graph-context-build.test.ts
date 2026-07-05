import { describe, it, expect } from "vitest";
import type { GraphNode } from "@codewatch/graph";
import {
  buildContextDossier,
  type ContextBuildInput,
} from "../commands/graph-context-build.js";
import { renderContextMarkdown } from "../commands/graph-context-format.js";
import type { NodeMetrics } from "../commands/dashboard-node-metrics.js";

function node(id: string, kind: GraphNode["kind"], extra: Partial<GraphNode> = {}): GraphNode {
  return { id, kind, name: extra.name ?? id.split(/[/#]/).pop()!, ...extra };
}

const NODES: GraphNode[] = [
  node("src/a.ts", "file"),
  node("src/b.ts", "file"),
  node("src/c.ts", "file"),
  node("src/d.ts", "file"),
  node("src/a.ts#foo", "symbol", { parentId: "src/a.ts", attrs: { exported: true, startLine: 3, endLine: 20 } }),
  node("src/a.ts#helper", "symbol", { parentId: "src/a.ts", attrs: { exported: false } }),
  node("src/b.ts#bar", "symbol", { parentId: "src/b.ts", attrs: { exported: true } }),
];

// c & d both import foo AND bar (→ foo/bar co-import pair, count 2); b imports foo only.
const REF_EDGES = [
  { srcId: "src/b.ts", dstId: "src/a.ts#foo" },
  { srcId: "src/c.ts", dstId: "src/a.ts#foo" },
  { srcId: "src/c.ts", dstId: "src/b.ts#bar" },
  { srcId: "src/d.ts", dstId: "src/a.ts#foo" },
  { srcId: "src/d.ts", dstId: "src/b.ts#bar" },
];

const METRICS = new Map<string, NodeMetrics>([
  ["src/a.ts", { loc: 100, cognitiveMax: 12, cyclomaticMax: 5, fanIn: 3, fanOut: 0, role: "source" }],
  ["src/a.ts#foo", { cognitiveMax: 10, cyclomaticMax: 4, utilization: 3 }],
  ["src/a.ts#helper", { cognitiveMax: 6, utilization: 0 }],
  ["src/b.ts#bar", { cognitiveMax: 2, utilization: 2 }],
]);

function input(target: string, kind: "file" | "symbol"): ContextBuildInput {
  return {
    target: NODES.find((n) => n.id === target)!,
    kind,
    provenance: { snapshotId: 1, ref: "HEAD", commitHash: "abc123", takenAt: "2026-07-05T00:00:00Z", indexVersion: "0.10.0" },
    nodes: NODES,
    refEdges: REF_EDGES,
    importEdges: [{ srcId: "src/b.ts", dstId: "src/a.ts" }],
    metrics: METRICS,
    churnByFile: new Map([["src/a.ts", 5]]),
    churnWindowDays: 30,
    centrality: new Map([["src/a.ts", 0.4]]),
    ownership: null,
    roleByFile: new Map([["src/d.ts", "test"]]), // d is a test file → split out of source consumers
  };
}

describe("buildContextDossier — file target", () => {
  const d = buildContextDossier(input("src/a.ts", "file"));

  it("projects file metrics, churn and centrality", () => {
    expect(d.target).toMatchObject({ kind: "file", path: "src/a.ts" });
    expect(d.file?.metrics.loc).toBe(100);
    expect(d.file?.churn).toEqual({ windowDays: 30, value: 5 });
    expect(d.file?.centrality).toBe(0.4);
  });

  it("ranks exports before internal helpers", () => {
    const names = d.file!.symbols.map((s) => s.name);
    expect(names).toEqual(["foo", "helper"]);
    expect(d.file!.symbols[0]).toMatchObject({ exported: true, utilization: 3, consumers: 3 });
    expect(d.file!.symbols[1]).toMatchObject({ exported: false, consumers: 0 });
  });

  it("splits inbound consumers by role and drops stable/zero blast-radius symbols", () => {
    expect(d.file?.consumers).toMatchObject({
      source: ["src/b.ts", "src/c.ts"],
      test: ["src/d.ts"],
      counts: { source: 2, test: 1, total: 3 },
    });
    expect(d.file?.blastRadius.map((b) => b.name)).toEqual(["foo"]);
    expect(d.file?.blastRadius[0]?.score).toBe(150); // 3 × 10 × 5
  });

  it("stamps a schema version", () => {
    expect(d.schemaVersion).toBe("1");
  });

  it("notes the missing type signature and omitted ownership", () => {
    expect(d.notes.some((n) => /type signatures/.test(n))).toBe(true);
    expect(d.notes.some((n) => /Ownership omitted/.test(n))).toBe(true);
    expect(d.file?.ownership).toBeNull();
  });
});

describe("buildContextDossier — symbol target", () => {
  const d = buildContextDossier(input("src/a.ts#foo", "symbol"));

  it("projects complexity, utilization and role-split consumers", () => {
    expect(d.target).toMatchObject({ kind: "symbol", name: "foo", path: "src/a.ts" });
    expect(d.symbol?.complexity).toEqual({ cognitive: 10, cyclomatic: 4 });
    expect(d.symbol?.utilization).toBe(3);
    expect(d.symbol?.consumers).toMatchObject({
      source: ["src/b.ts", "src/c.ts"],
      test: ["src/d.ts"],
    });
    expect(d.symbol?.blastRadius).toBe(150);
  });

  it("exposes null signature/purpose slots (G1/G2, not yet indexed)", () => {
    expect(d.symbol?.signature).toBeNull();
    expect(d.symbol?.purpose).toBeNull();
  });

  it("surfaces co-import coupling partners", () => {
    expect(d.symbol?.coupledWith).toEqual([
      { symbolId: "src/b.ts#bar", name: "bar", fileId: "src/b.ts", coImports: 2 },
    ]);
  });
});

describe("renderContextMarkdown", () => {
  it("renders a readable projection of the same facts", () => {
    const md = renderContextMarkdown(buildContextDossier(input("src/a.ts", "file")));
    expect(md).toContain("# src/a.ts");
    expect(md).toContain("Blast radius");
    expect(md).toContain("foo");
  });
});
