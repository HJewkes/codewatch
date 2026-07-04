import { describe, it, expect } from "vitest";
import type { GraphMetric, GraphNode } from "@codewatch/graph";
import { buildReportContext } from "../commands/graph-report-sections.js";
import { topGrowthRisks } from "../commands/graph-report-quality-sections.js";

const file = (id: string): GraphNode => ({ id, kind: "file", name: id });
const depth = (nodeId: string, value: number): GraphMetric => ({
  nodeId,
  name: "loop_depth",
  value,
  unit: "count",
});

const nodes: GraphNode[] = [
  file("src/quad.ts"),
  file("src/cubic.ts"),
  file("src/quartic.ts"),
  file("src/flat.ts"),
];
const metrics: GraphMetric[] = [
  depth("src/quad.ts", 2),
  depth("src/cubic.ts", 3),
  depth("src/quartic.ts", 4),
  depth("src/flat.ts", 1),
];

function ctx() {
  return buildReportContext({
    nodes,
    metrics,
    excluders: [],
    excludedRoles: new Set(),
    windowDays: 30,
  });
}

describe("topGrowthRisks (C-66)", () => {
  it("flags loop_depth >= 2 with a shape label, deepest first", () => {
    const rows = topGrowthRisks(ctx(), 10);
    expect(rows.map((r) => [r.nodeId, r.loopDepth, r.shape])).toEqual([
      ["src/quartic.ts", 4, "4-deep loop nesting"],
      ["src/cubic.ts", 3, "cubic-shaped"],
      ["src/quad.ts", 2, "quadratic-shaped"],
    ]);
  });

  it("does not flag depth-1 (unremarkable) files", () => {
    expect(topGrowthRisks(ctx(), 10).map((r) => r.nodeId)).not.toContain("src/flat.ts");
  });
});
