import { describe, it, expect } from "vitest";
import {
  openDatabase,
  type GraphDatabase,
  type GraphEdge,
  type GraphMetric,
  type GraphNode,
  type NodeRole,
} from "@codewatch/graph";
import { generateSuite } from "../oracle.js";
import type { OracleTask } from "../types.js";

/**
 * Synthetic graph exercising all four task types and all three strata:
 *   - b.ts imports a.ts directly (.js→.ts)          → import-chain-reachable
 *   - b.ts reaches util.ts#helper through the barrel  → structurally-hidden
 *   - a.ts imports util.ts#utilRun (name-token match) → semantic-findable
 *   - c.test.ts is a test-role consumer               → role split
 *   - a.ts / util.ts carry churn + complexity         → blast radius
 */
function file(id: string, role?: NodeRole): GraphNode {
  return { id, kind: "file", name: id, role };
}
function symbol(id: string, parentId: string): GraphNode {
  return {
    id,
    kind: "symbol",
    name: id.split("#")[1]!,
    parentId,
    attrs: { exported: true, startLine: 1, endLine: 5 },
  };
}
function ref(srcId: string, dstId: string, specifier: string): GraphEdge {
  return { srcId, dstId, kind: "references", attrs: { specifier, weight: 1 } };
}
function imp(srcId: string, dstId: string): GraphEdge {
  return { srcId, dstId, kind: "imports", attrs: { specifier: dstId, weight: 1 } };
}
function metric(nodeId: string, name: string, value: number): GraphMetric {
  return { nodeId, name, value };
}

function seedGraph(db: GraphDatabase): number {
  const snap = db.createSnapshot({ ref: "HEAD", indexVersion: "test" });
  db.insertNodes(snap, [
    file("src/a.ts"),
    file("src/b.ts"),
    file("src/util.ts"),
    file("src/index.ts", "barrel"),
    file("src/c.test.ts", "test"),
    symbol("src/a.ts#alpha", "src/a.ts"),
    symbol("src/util.ts#helper", "src/util.ts"),
    symbol("src/util.ts#utilRun", "src/util.ts"),
  ]);
  db.insertEdges(snap, [
    ref("src/b.ts", "src/a.ts#alpha", "./a.js"),
    ref("src/c.test.ts", "src/a.ts#alpha", "./a.js"),
    ref("src/b.ts", "src/util.ts#helper", "./index.js"),
    ref("src/c.test.ts", "src/util.ts#helper", "./util.js"),
    ref("src/a.ts", "src/util.ts#utilRun", "./util.js"),
    imp("src/b.ts", "src/a.ts"),
    imp("src/b.ts", "src/index.ts"),
    imp("src/a.ts", "npm:x"),
  ]);
  db.insertMetrics(snap, [
    metric("src/a.ts#alpha", "utilization", 2),
    metric("src/util.ts#helper", "utilization", 2),
    metric("src/util.ts#utilRun", "utilization", 1),
    metric("src/a.ts#alpha", "symbol_cognitive", 5),
    metric("src/util.ts#helper", "symbol_cognitive", 3),
    metric("src/util.ts#utilRun", "symbol_cognitive", 1),
    metric("src/a.ts", "churn_30d", 4),
    metric("src/util.ts", "churn_30d", 2),
    metric("src/b.ts", "churn_30d", 0),
  ]);
  return snap;
}

function byId(tasks: OracleTask[], id: string): OracleTask {
  const t = tasks.find((x) => x.id === id);
  if (!t) throw new Error(`task ${id} not found`);
  return t;
}

describe("generateSuite", () => {
  function suiteOf() {
    const db = openDatabase(":memory:");
    seedGraph(db);
    const suite = generateSuite(db, { perTypeCap: 10 });
    db.close();
    return suite;
  }

  it("emits every task type with graph-derived counts", () => {
    const { counts } = suiteOf();
    expect(counts.byType).toEqual({
      dependencies: 3,
      "reverse-deps": 2,
      "prod-vs-test-consumers": 3,
      "blast-radius": 2,
    });
    expect(counts.total).toBe(10);
  });

  it("computes file dependencies as the union of ref-origins and imports", () => {
    const t = byId(suiteOf().tasks, "dependencies::src/b.ts");
    expect(t.groundTruth).toEqual({
      kind: "list",
      items: ["src/a.ts", "src/index.ts", "src/util.ts"],
    });
  });

  it("computes reverse dependencies from inbound references", () => {
    const t = byId(suiteOf().tasks, "reverse-deps::src/a.ts");
    expect(t.groundTruth).toEqual({
      kind: "list",
      items: ["src/b.ts", "src/c.test.ts"],
    });
  });

  it("splits a symbol's consumers into production vs test", () => {
    const t = byId(suiteOf().tasks, "prod-vs-test-consumers::src/a.ts#alpha");
    expect(t.groundTruth).toEqual({
      kind: "role-split",
      source: ["src/b.ts"],
      test: ["src/c.test.ts"],
    });
  });

  it("ranks blast radius by utilization × complexity × churn", () => {
    const t = byId(suiteOf().tasks, "blast-radius::src/util.ts");
    // helper: 2×3×2=12 outranks utilRun: 1×1×2=2
    expect(t.groundTruth).toEqual({ kind: "ranked", items: ["helper", "utilRun"] });
  });

  it("assigns strata by the documented discoverability heuristic", () => {
    const tasks = suiteOf().tasks;
    // direct .js imports → import-chain-reachable
    expect(byId(tasks, "prod-vs-test-consumers::src/a.ts#alpha").stratum).toBe(
      "import-chain-reachable",
    );
    // barrel + direct tie → hardest wins → structurally-hidden
    expect(byId(tasks, "prod-vs-test-consumers::src/util.ts#helper").stratum).toBe(
      "structurally-hidden",
    );
    // name-token match → semantic-findable
    expect(byId(tasks, "prod-vs-test-consumers::src/util.ts#utilRun").stratum).toBe(
      "semantic-findable",
    );
    // computed ranking → structurally-hidden by construction
    expect(byId(tasks, "blast-radius::src/a.ts").stratum).toBe("structurally-hidden");
  });

  it("is deterministic — identical graph yields byte-identical suites", () => {
    expect(JSON.stringify(suiteOf())).toBe(JSON.stringify(suiteOf()));
  });
});
