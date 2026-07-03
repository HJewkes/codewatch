import { describe, it, expect } from "vitest";
import { focusPackage, packagesInSnapshot } from "../focus-package.js";
import type { RenderInput } from "../types.js";

function file(id: string) {
  return { id, kind: "file" as const, name: id.split("/").pop() ?? id };
}
function edge(srcId: string, dstId: string) {
  return { srcId, dstId, kind: "imports" as const };
}

// graph package: a.ts → b.ts (intra), a.ts → core/x.ts (out), cli/m.ts → b.ts (in),
// plus a second cli→b edge to exercise folding.
const input: RenderInput = {
  snapshotId: 1,
  nodes: [
    file("packages/graph/src/a.ts"),
    file("packages/graph/src/b.ts"),
    file("packages/core/src/x.ts"),
    file("packages/cli/src/m.ts"),
    file("packages/cli/src/n.ts"),
    { id: "npm:elkjs", kind: "external", name: "elkjs" },
  ],
  edges: [
    edge("packages/graph/src/a.ts", "packages/graph/src/b.ts"),
    edge("packages/graph/src/a.ts", "packages/core/src/x.ts"),
    edge("packages/cli/src/m.ts", "packages/graph/src/b.ts"),
    edge("packages/cli/src/n.ts", "packages/graph/src/b.ts"),
    edge("packages/graph/src/a.ts", "npm:elkjs"),
  ],
};

describe("focusPackage", () => {
  const out = focusPackage(input, "graph");

  it("keeps only the focused package's files plus boundary stubs", () => {
    const files = out.nodes.filter((n) => n.kind === "file").map((n) => n.id).sort();
    expect(files).toEqual(["packages/graph/src/a.ts", "packages/graph/src/b.ts"]);
    const stubs = out.nodes.filter((n) => n.kind === "package").map((n) => n.id).sort();
    expect(stubs).toEqual(["cli", "core"]); // neighbours with a cross edge; elkjs (external) excluded
  });

  it("keeps intra-package edges between the focused files", () => {
    const intra = out.edges.find(
      (e) => e.srcId === "packages/graph/src/a.ts" && e.dstId === "packages/graph/src/b.ts",
    );
    expect(intra).toBeTruthy();
    expect(intra?.attrs?.weight).toBe(1);
  });

  it("redirects an outgoing cross-edge to the neighbour stub", () => {
    const outgoing = out.edges.find(
      (e) => e.srcId === "packages/graph/src/a.ts" && e.dstId === "core",
    );
    expect(outgoing).toBeTruthy();
  });

  it("folds parallel incoming cross-edges from a neighbour into one weighted stub edge", () => {
    const incoming = out.edges.filter(
      (e) => e.srcId === "cli" && e.dstId === "packages/graph/src/b.ts",
    );
    expect(incoming).toHaveLength(1);
    expect(incoming[0].attrs?.weight).toBe(2); // m.ts and n.ts both import b.ts
  });

  it("drops external (npm) endpoints entirely", () => {
    expect(out.nodes.some((n) => n.id.startsWith("npm:"))).toBe(false);
    expect(out.edges.some((e) => e.dstId.startsWith("npm:"))).toBe(false);
  });

  it("returns only stubs (no files) when the package has none", () => {
    const empty = focusPackage(input, "nonexistent");
    expect(empty.nodes.filter((n) => n.kind === "file")).toHaveLength(0);
  });
});

describe("packagesInSnapshot", () => {
  it("lists the distinct file-bearing packages, sorted", () => {
    expect(packagesInSnapshot(input)).toEqual(["cli", "core", "graph"]);
  });
});
