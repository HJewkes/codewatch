import { describe, it, expect } from "vitest";
import { collectNodeMetrics } from "../commands/dashboard-node-metrics.js";

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
});
