import { describe, it, expect } from "vitest";
import { renderMultiViewHtml, type GraphView } from "../template.js";
import type { RenderInput } from "../types.js";

const overview: RenderInput = {
  snapshotId: 1,
  nodes: [
    { id: "cli", kind: "package", name: "cli" },
    { id: "core", kind: "package", name: "core" },
  ],
  edges: [{ srcId: "cli", dstId: "core", kind: "imports", attrs: { weight: 3 } }],
};

const focus: RenderInput = {
  snapshotId: 1,
  nodes: [
    { id: "packages/cli/src/a.ts", kind: "file", name: "a.ts", role: "source" as never },
    { id: "core", kind: "package", name: "core" },
  ],
  edges: [{ srcId: "packages/cli/src/a.ts", dstId: "core", kind: "imports", attrs: { weight: 1 } }],
};

const views: GraphView[] = [
  { id: "__overview__", label: "All packages", input: overview },
  { id: "cli", label: "cli", input: focus, flat: true },
];

describe("renderMultiViewHtml", () => {
  it("bakes __GRAPH_VIEWS__ with every view and a view picker", async () => {
    const html = await renderMultiViewHtml(views, { title: "repo — architecture" });
    expect(html).toContain("window.__GRAPH_VIEWS__");
    expect(html).toContain('<select id="view-picker"');
    expect(html).toContain('value="__overview__"');
    expect(html).toContain('value="cli"');
    expect(html).toContain(">All packages<");
  });

  it("defaults __GRAPH__ to the first view (the overview)", async () => {
    const html = await renderMultiViewHtml(views);
    const m = html.match(/window\.__GRAPH__ = (\{.*?\});<\/script>/s);
    expect(m).toBeTruthy();
    const primary = JSON.parse(m![1].replace(/\\u003c/g, "<"));
    // Overview = 2 package nodes, no file nodes.
    expect(primary.nodes.map((n: { data: { kind: string } }) => n.data.kind).sort()).toEqual(["package", "package"]);
  });

  it("throws on an empty view list", async () => {
    await expect(renderMultiViewHtml([])).rejects.toThrow();
  });
});
