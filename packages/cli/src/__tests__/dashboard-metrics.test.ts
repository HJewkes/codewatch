import { describe, it, expect } from "vitest";
import {
  collectNodeMetrics,
  buildBlastRadius,
  type NodeMetrics,
  type SymbolUtil,
} from "../commands/dashboard-node-metrics.js";

describe("collectNodeMetrics", () => {
  it("folds flat metric rows into a per-node structural-metrics map", () => {
    const byNode = collectNodeMetrics([
      { nodeId: "a.ts", name: "loc", value: 120 },
      { nodeId: "a.ts", name: "cognitive_max", value: 18 },
      { nodeId: "a.ts", name: "cyclomatic_max", value: 12 },
      { nodeId: "a.ts", name: "max_nesting_depth", value: 4 },
      { nodeId: "a.ts", name: "fan_in", value: 7 },
      { nodeId: "a.ts", name: "fan_out", value: 3 },
      { nodeId: "a.ts", name: "utilization", value: 21 },
    ]);
    expect(byNode.get("a.ts")).toEqual({
      loc: 120, cognitiveMax: 18, cyclomaticMax: 12, maxNesting: 4, fanIn: 7, fanOut: 3, utilization: 21,
    });
  });

  it("ignores metric names the Dossier doesn't surface", () => {
    const byNode = collectNodeMetrics([
      { nodeId: "a.ts", name: "loc", value: 50 },
      { nodeId: "a.ts", name: "instability", value: 0.5 },
      { nodeId: "a.ts", name: "churn_30d", value: 900 },
    ]);
    expect(byNode.get("a.ts")).toEqual({ loc: 50 });
  });

  it("drops null-valued metrics (uncomputed) rather than storing null", () => {
    const byNode = collectNodeMetrics([
      { nodeId: "a.ts", name: "loc", value: 50 },
      { nodeId: "a.ts", name: "cognitive_max", value: null },
    ]);
    expect(byNode.get("a.ts")).toEqual({ loc: 50 });
  });

  it("keeps each file's metrics separate", () => {
    const byNode = collectNodeMetrics([
      { nodeId: "a.ts", name: "loc", value: 50 },
      { nodeId: "b.ts", name: "loc", value: 400 },
    ]);
    expect(byNode.get("a.ts")).toEqual({ loc: 50 });
    expect(byNode.get("b.ts")).toEqual({ loc: 400 });
    expect(byNode.size).toBe(2);
  });

  it("maps per-symbol complexity (C-58) onto a symbol node's cognitiveMax", () => {
    const byNode = collectNodeMetrics([
      { nodeId: "a.ts#hot", name: "symbol_cognitive", value: 25 },
      { nodeId: "a.ts#hot", name: "symbol_cyclomatic", value: 9 },
    ]);
    expect(byNode.get("a.ts#hot")).toEqual({ cognitiveMax: 25, cyclomaticMax: 9 });
  });
});

describe("buildBlastRadius (C-58 per-symbol complexity)", () => {
  const churn = new Map([["a.ts", 100]]);
  const symbols: SymbolUtil[] = [
    { symbolId: "a.ts#hot", name: "hot", fileId: "a.ts", utilization: 10 },
    { symbolId: "a.ts#cold", name: "cold", fileId: "a.ts", utilization: 10 },
  ];

  it("separates two exports of one hot file by their OWN complexity", () => {
    const metrics = new Map<string, NodeMetrics>([
      ["a.ts", { cognitiveMax: 20 }], // file-broadcast value
      ["a.ts#hot", { cognitiveMax: 30 }], // the risky export
      ["a.ts#cold", { cognitiveMax: 2 }], // a calm export in the same file
    ]);
    const out = buildBlastRadius(symbols, metrics, churn);
    const hot = out.find((e) => e.name === "hot");
    const cold = out.find((e) => e.name === "cold");
    // Per-symbol complexity is used, NOT the file's broadcast 20 — so the two
    // exports diverge instead of tying (the flatness C-58 fixes).
    expect(hot?.complexity).toBe(30);
    expect(cold?.complexity).toBe(2);
    expect(hot!.score).toBeGreaterThan(cold!.score);
  });

  it("falls back to file complexity for an export with no symbol complexity", () => {
    const metrics = new Map<string, NodeMetrics>([
      ["a.ts", { cognitiveMax: 20 }],
      // no a.ts#hot entry (e.g. a class or re-exported symbol)
    ]);
    const out = buildBlastRadius(
      [{ symbolId: "a.ts#hot", name: "hot", fileId: "a.ts", utilization: 10 }],
      metrics,
      churn,
    );
    expect(out[0]?.complexity).toBe(20);
  });
});
