import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser } from "playwright";
import { renderHtml } from "../template.js";
import type { RenderInput } from "../types.js";

let browser: Browser;
let workDir: string;

const fixture: RenderInput = {
  snapshotId: 1,
  nodes: [
    { id: "pkg/src/index.ts", kind: "file", name: "index.ts", role: "source" },
    { id: "pkg/src/util.ts", kind: "file", name: "util.ts", role: "source" },
    { id: "pkg/src/util.test.ts", kind: "file", name: "util.test.ts", role: "test" },
    { id: "npm:lodash", kind: "external", name: "lodash" },
  ],
  edges: [
    { srcId: "pkg/src/index.ts", dstId: "pkg/src/util.ts", kind: "imports" },
    { srcId: "pkg/src/index.ts", dstId: "npm:lodash", kind: "imports" },
    { srcId: "pkg/src/util.test.ts", dstId: "pkg/src/util.ts", kind: "imports" },
  ],
};

beforeAll(async () => {
  browser = await chromium.launch();
  workDir = await fs.mkdtemp(path.join(tmpdir(), "code-style-render-e2e-"));
}, 30_000);

afterAll(async () => {
  await browser?.close();
  if (workDir) await fs.rm(workDir, { recursive: true, force: true });
});

async function renderAndLoad(input: RenderInput): Promise<{
  consoleErrors: string[];
  pageErrors: string[];
  cyState: { nodeCount: number; edgeCount: number; canvasCount: number; danglingCount: number };
}> {
  const html = await renderHtml(input);
  const outPath = path.join(workDir, `render-${Date.now()}.html`);
  await fs.writeFile(outPath, html);

  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  try {
    await page.goto(`file://${outPath}`);
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __GRAPH__?: unknown }).__GRAPH__ !==
        "undefined",
      undefined,
      { timeout: 5000 },
    );
    const cyState = await page.evaluate(() => {
      const g = (window as unknown as { __GRAPH__: {
        nodes: Array<{ data: { id: string } }>;
        edges: Array<{ data: { source: string; target: string } }>;
      } }).__GRAPH__;
      const ids = new Set(g.nodes.map((n) => n.data.id));
      const dangling = g.edges.filter(
        (e) => !ids.has(e.data.source) || !ids.has(e.data.target),
      );
      const canvases = document.querySelectorAll("#cy canvas").length;
      return {
        nodeCount: g.nodes.length,
        edgeCount: g.edges.length,
        canvasCount: canvases,
        danglingCount: dangling.length,
      };
    });
    return { consoleErrors, pageErrors, cyState };
  } finally {
    await page.close();
  }
}

describe("renderHtml in a real browser", () => {
  it("loads without console errors and mounts the cytoscape canvases", async () => {
    const { consoleErrors, pageErrors, cyState } = await renderAndLoad(fixture);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    // Output may include synthetic `pkg:*` compound parents on top of input.
    expect(cyState.nodeCount).toBeGreaterThanOrEqual(fixture.nodes.length);
    expect(cyState.edgeCount).toBe(fixture.edges.length);
    expect(cyState.canvasCount).toBeGreaterThan(0);
    expect(cyState.danglingCount).toBe(0);
  }, 30_000);

  it("survives an empty graph without errors", async () => {
    const empty: RenderInput = { snapshotId: 1, nodes: [], edges: [] };
    const { consoleErrors, pageErrors } = await renderAndLoad(empty);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  }, 30_000);
});
