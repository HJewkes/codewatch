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

  it("stays under 500 KB for the small fixture", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html.length).toBeLessThan(500 * 1024);
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

  it("renders a toolbar with chips for present node kinds (and not absent ones)", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toContain('class="toolbar"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-kind="file"');
    expect(html).toContain('data-kind="external"');
    // No symbol/module/package nodes in the fixture, so no chips for them.
    expect(html).not.toContain('data-kind="symbol"');
    expect(html).not.toContain('data-kind="module"');
    expect(html).not.toContain('data-kind="package"');
    // Labels and counts present.
    expect(html).toContain(">File<");
    expect(html).toContain(">External<");
  });

  it("renders edge-kind chips for present edge kinds", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toContain('data-edge-kind="imports"');
    expect(html).not.toContain('data-edge-kind="re-exports"');
  });

  it("includes a reset-view button in the toolbar", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toContain('id="reset-view"');
    expect(html).toContain("Reset view");
  });

  it("includes Fan-in/Fan-out side-panel scaffolding in the client script", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toContain("Fan-in");
    expect(html).toContain("Fan-out");
    expect(html).toContain("Show neighbors");
  });

  it("calls cy.fit on initial render for fit-to-viewport", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toMatch(/cy\.fit\(undefined,\s*50\)/);
  });

  it("uses a minimal footer with rendered node/edge counts", async () => {
    const html = await renderHtml(tinyGraph);
    expect(html).toContain("rendered with cytoscape.js");
    expect(html).toContain(`${tinyGraph.nodes.length} nodes`);
    // Old legend swatches in the footer should be gone.
    expect(html).not.toMatch(/<footer>[\s\S]*Legend:[\s\S]*<\/footer>/);
  });

  describe("role overlay", () => {
    const roleyGraph: RenderInput = {
      snapshotId: 1,
      nodes: [
        { id: "a/src/foo.ts", kind: "file", name: "foo", role: "source" },
        { id: "a/src/foo.test.ts", kind: "file", name: "foo.test", role: "test" },
        { id: "a/src/index.ts", kind: "file", name: "index", role: "barrel" },
        { id: "npm:lodash", kind: "external", name: "lodash" },
      ],
      edges: [],
    };

    it("renders a Role group in the toolbar with one chip per present role", async () => {
      const html = await renderHtml(roleyGraph);
      expect(html).toContain('aria-label="Role"');
      expect(html).toContain('class="group-label">Role');
      expect(html).toContain('data-role="source"');
      expect(html).toContain('data-role="test"');
      expect(html).toContain('data-role="barrel"');
    });

    it("omits the Role group entirely when no node has a role", async () => {
      const html = await renderHtml(tinyGraph);
      expect(html).not.toContain('aria-label="Role"');
    });

    it("threads role into the cytoscape data and side-panel scaffolding", async () => {
      const html = await renderHtml(roleyGraph);
      expect(html).toContain('"role":"test"');
      expect(html).toContain('"role":"barrel"');
      expect(html).toContain('renderRow("role"');
    });

    it("wires the role chip handler into the client script", async () => {
      const html = await renderHtml(roleyGraph);
      expect(html).toContain('chip.role-chip');
      expect(html).toContain('hiddenRoles');
    });
  });
});
