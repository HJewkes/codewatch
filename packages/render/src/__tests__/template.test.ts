import { describe, it, expect } from "vitest";
import { renderHtml } from "../template.js";
import type { RenderInput } from "../types.js";

const tinyGraph: RenderInput = {
  snapshotId: 7,
  nodes: [
    { id: "packages/a/src/index.ts", kind: "file", name: "index.ts" },
    { id: "packages/a/src/util.ts", kind: "file", name: "util.ts" },
    { id: "npm:lodash", kind: "external", name: "lodash" },
  ],
  edges: [
    {
      srcId: "packages/a/src/index.ts",
      dstId: "packages/a/src/util.ts",
      kind: "imports",
    },
    {
      srcId: "packages/a/src/index.ts",
      dstId: "npm:lodash",
      kind: "imports",
    },
  ],
};

describe("renderHtml", () => {
  it("produces a non-empty HTML5 document", async () => {
    const html = await renderHtml(tinyGraph, { title: "test render" });
    expect(html.length).toBeGreaterThan(10_000);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("test render");
  });

  it("inlines the cytoscape bundle (no CDN)", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toContain("Cytoscape Consortium");
    expect(html).not.toMatch(/https?:\/\/cdn\./);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("embeds the graph JSON containing the expected node ids", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toContain("window.__GRAPH__");
    for (const n of tinyGraph.nodes) {
      expect(html).toContain(n.id);
    }
  });

  it("escapes </script> sequences inside the embedded JSON", async () => {
    const trickyGraph: RenderInput = {
      snapshotId: 1,
      nodes: [{ id: "a</script>b", kind: "file", name: "x" }],
      edges: [],
    };
    const html = await renderHtml(trickyGraph);
    // The literal "</script>" sequence must not appear inside the JSON payload.
    const graphAssignmentIndex = html.indexOf("window.__GRAPH__");
    const tail = html.slice(graphAssignmentIndex);
    const closingTagInJson = tail
      .slice(0, tail.indexOf("</script>") + "</script>".length - 1);
    expect(closingTagInJson.includes("</script>")).toBe(false);
  });
});
