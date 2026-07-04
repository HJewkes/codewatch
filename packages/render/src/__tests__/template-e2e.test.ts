import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser } from "playwright";
import { renderHtml } from "../template.js";
import type { RenderInput, RenderOptions } from "../types.js";

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
  workDir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-render-e2e-"));
}, 30_000);

afterAll(async () => {
  await browser?.close();
  if (workDir) await fs.rm(workDir, { recursive: true, force: true });
});

interface LoadResult {
  consoleErrors: string[];
  pageErrors: string[];
  cyState: { nodeCount: number; edgeCount: number; canvasCount: number; danglingCount: number };
  // Layout mode + geometry, read off window.__cy once the client has laid out.
  layout: {
    mode: string;
    maxPositionDrift: number;
    routedEdges: number;
    taxiEdges: number;
    totalEdges: number;
  };
}

async function renderAndLoad(
  input: RenderInput,
  options: RenderOptions = {},
): Promise<LoadResult> {
  const html = await renderHtml(input, options);
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
    // Wait for the client to build the graph (__cy) so layout + routing are set.
    await page.waitForFunction(
      () => typeof (window as unknown as { __cy?: unknown }).__cy !== "undefined",
      undefined,
      { timeout: 15000 },
    );
    const state = await page.evaluate(evaluateLoadState);
    return { consoleErrors, pageErrors, ...state };
  } finally {
    await page.close();
  }
}

// Runs in the browser: reads graph consistency off __GRAPH__ and layout geometry
// off __cy. Extracted so the assertions read as data, not DOM-poking.
function evaluateLoadState(): Omit<LoadResult, "consoleErrors" | "pageErrors"> {
  const w = window as unknown as {
    __cy: {
      getElementById: (id: string) => { position: () => { x: number; y: number } };
      edges: () => Array<{ style: (k: string) => string }>;
    };
    __layoutMode: string;
    __GRAPH__: {
      nodes: Array<{ data: { id: string }; position?: { x: number; y: number } }>;
      edges: Array<{ data: { source: string; target: string } }>;
    };
  };
  const g = w.__GRAPH__;
  const ids = new Set(g.nodes.map((n) => n.data.id));
  const dangling = g.edges.filter((e) => !ids.has(e.data.source) || !ids.has(e.data.target));
  let maxPositionDrift = 0;
  for (const n of g.nodes) {
    if (!n.position) continue;
    const p = w.__cy.getElementById(n.data.id).position();
    maxPositionDrift = Math.max(maxPositionDrift, Math.abs(p.x - n.position.x), Math.abs(p.y - n.position.y));
  }
  let routedEdges = 0;
  let taxiEdges = 0;
  for (const e of w.__cy.edges()) {
    const cs = e.style("curve-style");
    if (cs === "segments" || cs === "straight") routedEdges++;
    if (cs === "taxi") taxiEdges++;
  }
  return {
    cyState: {
      nodeCount: g.nodes.length,
      edgeCount: g.edges.length,
      canvasCount: document.querySelectorAll("#cy canvas").length,
      danglingCount: dangling.length,
    },
    layout: { mode: w.__layoutMode, maxPositionDrift, routedEdges, taxiEdges, totalEdges: g.edges.length },
  };
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

const compoundFixture: RenderInput = {
  snapshotId: 1,
  nodes: [
    { id: "cli/index.ts", kind: "file", name: "index.ts", role: "source" },
    { id: "cli/run.ts", kind: "file", name: "run.ts", role: "source" },
    { id: "core/graph.ts", kind: "file", name: "graph.ts", role: "source" },
    { id: "core/util.ts", kind: "file", name: "util.ts", role: "source" },
  ],
  edges: [
    { srcId: "cli/index.ts", dstId: "cli/run.ts", kind: "imports" }, // intra-package
    { srcId: "cli/run.ts", dstId: "core/graph.ts", kind: "imports" }, // cross-package
    { srcId: "core/graph.ts", dstId: "core/util.ts", kind: "imports" }, // intra-package
  ],
};

describe("compound file-level graph (ELK INCLUDE_CHILDREN)", () => {
  it("renders elk-preset with faithful positions and orthogonal routes", async () => {
    const { consoleErrors, pageErrors, layout } = await renderAndLoad(compoundFixture, {
      compound: true,
    });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    // The compound graph now uses ELK's preset layout, not cose-bilkent.
    expect(layout.mode).toBe("elk-preset");
    // Cytoscape preset honors the server's absolute node centers to sub-pixel.
    expect(layout.maxPositionDrift).toBeLessThan(0.01);
    // Every edge renders ELK's route; none falls back to the taxi/bezier default.
    expect(layout.routedEdges).toBe(layout.totalEdges);
    expect(layout.taxiEdges).toBe(0);
  }, 30_000);
});
