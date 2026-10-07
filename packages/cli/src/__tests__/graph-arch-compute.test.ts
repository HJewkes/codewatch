import { describe, it, expect } from "vitest";
import type { GraphNode } from "@titan-design/code-graph";
import { filteredFileIds } from "../commands/graph-arch-compute.js";

describe("filteredFileIds excludes tests from the dependency graph by default (C-63)", () => {
  const nodes: GraphNode[] = [
    { id: "src/a.ts", kind: "file", name: "a.ts", role: "source" },
    { id: "src/a.test.ts", kind: "file", name: "a.test.ts", role: "test" },
    { id: "src/fx.ts", kind: "file", name: "fx.ts", role: "fixture" },
  ];

  it("drops test and fixture roles without needing --exclude-role", () => {
    const ids = filteredFileIds(nodes, {});
    expect(ids).toEqual(["src/a.ts"]);
  });
});
