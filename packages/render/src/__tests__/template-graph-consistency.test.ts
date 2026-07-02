import { describe, it, expect } from "vitest";
import { renderHtml } from "../template.js";
import type { RenderInput } from "../types.js";

interface ParsedGraph {
  snapshotId: number;
  nodes: Array<{ data: { id: string } }>;
  edges: Array<{
    data: {
      id: string;
      source: string;
      target: string;
      weight?: number;
      width: number;
      label: string;
    };
  }>;
}

function extractGraphJson(html: string): ParsedGraph {
  const marker = "window.__GRAPH__ = ";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("__GRAPH__ assignment not found");
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);
  if (jsonEnd < 0) throw new Error("__GRAPH__ closing semicolon not found");
  const raw = html
    .slice(jsonStart, jsonEnd)
    .replace(/\\u003c/g, "<");
  return JSON.parse(raw);
}

function findDangling(g: ParsedGraph): typeof g.edges {
  const ids = new Set(g.nodes.map((n) => n.data.id));
  return g.edges.filter(
    (e) => !ids.has(e.data.source) || !ids.has(e.data.target),
  );
}

const fixture: RenderInput = {
  snapshotId: 42,
  nodes: [
    { id: "pkg/src/index.ts", kind: "file", name: "index.ts", role: "source" },
    { id: "pkg/src/util.ts", kind: "file", name: "util.ts", role: "source" },
    { id: "pkg/src", kind: "module", name: "src" },
    { id: "npm:lodash", kind: "external", name: "lodash" },
  ],
  edges: [
    { srcId: "pkg/src/index.ts", dstId: "pkg/src/util.ts", kind: "imports" },
    { srcId: "pkg/src/index.ts", dstId: "npm:lodash", kind: "imports" },
    { srcId: "pkg/src/util.ts", dstId: "pkg/src", kind: "re-exports" },
  ],
};

describe("renderHtml graph consistency", () => {
  it("embeds a __GRAPH__ payload that parses as valid JSON", async () => {
    const html = await renderHtml(fixture);
    const g = extractGraphJson(html);
    expect(g.snapshotId).toBe(42);
    // 4 input nodes + 2 synthetic package containers (pkg:pkg, pkg:external)
    expect(g.nodes.length).toBeGreaterThanOrEqual(4);
    expect(g.edges.length).toBe(3);
  });

  it("emits no edges referencing nonexistent nodes", async () => {
    const html = await renderHtml(fixture);
    const g = extractGraphJson(html);
    expect(findDangling(g)).toEqual([]);
  });

  it("preserves every input node id in the output (may add synthetic parents)", async () => {
    const html = await renderHtml(fixture);
    const g = extractGraphJson(html);
    const outIds = new Set(g.nodes.map((n) => n.data.id));
    for (const n of fixture.nodes) {
      expect(outIds.has(n.id)).toBe(true);
    }
    // Synthetic parents always use a "pkg:" prefix so the namespaces don't collide.
    const extras = [...outIds].filter(
      (id) => !fixture.nodes.some((n) => n.id === id),
    );
    for (const id of extras) {
      expect(id.startsWith("pkg:")).toBe(true);
    }
  });

  it("carries package-edge weight into edge data as width + count label (C-46)", async () => {
    const weighted: RenderInput = {
      snapshotId: 7,
      nodes: [
        { id: "core", kind: "package", name: "core" },
        { id: "cli", kind: "package", name: "cli" },
      ],
      edges: [
        { srcId: "cli", dstId: "core", kind: "imports", attrs: { weight: 9 } },
        { srcId: "core", dstId: "cli", kind: "imports", attrs: { weight: 1 } },
      ],
    };
    const html = await renderHtml(weighted);
    const g = extractGraphJson(html);
    const heavy = g.edges.find((e) => e.data.source === "cli");
    const light = g.edges.find((e) => e.data.source === "core");
    // The weight reaches the Cytoscape edge data at all (the C-46 gap: it used
    // to be dropped before assembly).
    expect(heavy?.data.weight).toBe(9);
    expect(light?.data.weight).toBe(1);
    // Width scales with weight; a weight-1 edge keeps the base hairline.
    expect(light?.data.width).toBeCloseTo(1.2);
    expect(heavy!.data.width).toBeGreaterThan(light!.data.width);
    // Only the aggregated (>1) edge gets a "×N" count label.
    expect(heavy?.data.label).toBe("×9");
    expect(light?.data.label).toBe("");
  });

  it("leaves weightless file edges at the base width with no label", async () => {
    const html = await renderHtml(fixture);
    const g = extractGraphJson(html);
    for (const e of g.edges) {
      expect(e.data.weight).toBeUndefined();
      expect(e.data.width).toBeCloseTo(1.2);
      expect(e.data.label).toBe("");
    }
  });

  it("preserves the exact edge endpoints from input", async () => {
    const html = await renderHtml(fixture);
    const g = extractGraphJson(html);
    const outEndpoints = g.edges
      .map((e) => `${e.data.source} → ${e.data.target}`)
      .sort();
    const inEndpoints = fixture.edges
      .map((e) => `${e.srcId} → ${e.dstId}`)
      .sort();
    expect(outEndpoints).toEqual(inEndpoints);
  });
});
