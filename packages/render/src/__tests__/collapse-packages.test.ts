import { describe, it, expect } from "vitest";
import { collapseToPackages } from "../collapse-packages.js";
import type { RenderInput } from "../types.js";

function node(id: string, kind: "file" | "module" | "external"): RenderInput["nodes"][number] {
  return { id, kind, name: id.split("/").pop() ?? id };
}

describe("collapseToPackages", () => {
  const input: RenderInput = {
    snapshotId: 1,
    nodes: [
      node("packages/graph/src/a.ts", "file"),
      node("packages/graph/src/b.ts", "file"),
      node("packages/cli/src/c.ts", "file"),
      node("packages/graph/src/a", "module"), // orphan twin — must be dropped
      node("npm:vitest", "external"), // external — must be dropped
    ],
    edges: [
      { srcId: "packages/cli/src/c.ts", dstId: "packages/graph/src/a.ts", kind: "imports" },
      { srcId: "packages/cli/src/c.ts", dstId: "packages/graph/src/b.ts", kind: "imports" },
      { srcId: "packages/graph/src/a.ts", dstId: "packages/graph/src/b.ts", kind: "imports" }, // intra-pkg — dropped
      { srcId: "packages/cli/src/c.ts", dstId: "npm:vitest", kind: "imports" }, // external — dropped
    ],
  };

  it("emits one node per package with a file count, dropping modules and externals", () => {
    const out = collapseToPackages(input);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["cli", "graph"]);
    expect(out.nodes.every((n) => n.kind === "package")).toBe(true);
    const graph = out.nodes.find((n) => n.id === "graph");
    expect(graph!.attrs).toMatchObject({ fileCount: 2 });
  });

  it("folds parallel cross-package edges into one weighted edge; drops intra-package and external", () => {
    const out = collapseToPackages(input);
    // cli -> graph twice (via a.ts and b.ts) collapses to weight 2; no others.
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ srcId: "cli", dstId: "graph", kind: "imports" });
    expect(out.edges[0]!.attrs).toMatchObject({ weight: 2 });
  });
});
