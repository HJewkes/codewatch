import { describe, it, expect } from "vitest";
import { renderHtml } from "../template.js";
import type { RenderInput } from "../types.js";

interface NodeData {
  id: string;
  kind: string;
  label: string;
  parent?: string;
  position?: { x: number; y: number };
}

function extractNodes(html: string): NodeData[] {
  const marker = "window.__GRAPH__ = ";
  const start = html.indexOf(marker);
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);
  const raw = html.slice(jsonStart, jsonEnd).replace(/\\u003c/g, "<");
  const g = JSON.parse(raw) as {
    nodes: Array<{ data: NodeData; position?: { x: number; y: number } }>;
  };
  return g.nodes.map((n) => ({ ...n.data, position: n.position }));
}

// Two packages, each with subdirectories, plus a file sitting directly at a
// package's src root (which should get its own `src` box).
const fixture: RenderInput = {
  snapshotId: 1,
  nodes: [
    { id: "packages/cli/src/commands/a.ts", kind: "file", name: "a.ts", role: "source" },
    { id: "packages/cli/src/commands/b.ts", kind: "file", name: "b.ts", role: "source" },
    { id: "packages/cli/src/utils/c.ts", kind: "file", name: "c.ts", role: "source" },
    { id: "packages/graph/src/d.ts", kind: "file", name: "d.ts", role: "source" },
  ],
  edges: [
    { srcId: "packages/cli/src/commands/a.ts", dstId: "packages/cli/src/utils/c.ts", kind: "imports" },
    { srcId: "packages/cli/src/commands/a.ts", dstId: "packages/graph/src/d.ts", kind: "imports" },
    { srcId: "packages/cli/src/utils/c.ts", dstId: "packages/graph/src/d.ts", kind: "imports" },
  ],
};

describe("nested drill-down view (C-56)", () => {
  it("nests files inside directory boxes inside package boxes", async () => {
    const html = await renderHtml(fixture, { compound: true, nested: true });
    const nodes = extractNodes(html);
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // A file's compound parent is its directory box.
    const fileA = byId.get("packages/cli/src/commands/a.ts");
    expect(fileA?.parent).toBe("dir:packages/cli/src/commands");

    // The directory box exists, is a compound parent, and nests in its package.
    const cmdBox = byId.get("dir:packages/cli/src/commands");
    expect(cmdBox?.kind).toBe("package");
    expect(cmdBox?.parent).toBe("pkg:cli");
    // Labeled by its own directory name, not the full path.
    expect(cmdBox?.label).toBe("commands");

    // The package box is the outermost — it has no parent.
    const pkgBox = byId.get("pkg:cli");
    expect(pkgBox?.parent).toBeUndefined();

    // A file directly under a package's src gets its own `src` box, still nested.
    expect(byId.get("packages/graph/src/d.ts")?.parent).toBe("dir:packages/graph/src");
    expect(byId.get("dir:packages/graph/src")?.parent).toBe("pkg:graph");
  });

  it("marks the graph elkCompound and gives every file an ELK position", async () => {
    const html = await renderHtml(fixture, { compound: true, nested: true });
    expect(html).toContain('"elkCompound":true');
    const files = extractNodes(html).filter((n) => n.kind === "file");
    for (const f of files) {
      expect(Number.isFinite(f.position?.x)).toBe(true);
      expect(Number.isFinite(f.position?.y)).toBe(true);
    }
  });
});
