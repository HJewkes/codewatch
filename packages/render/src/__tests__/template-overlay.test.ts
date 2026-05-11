import { describe, it, expect } from "vitest";
import { renderHtml } from "../template.js";
import type { RenderInput } from "../types.js";

const tinyGraphWithMetrics: RenderInput = {
  snapshotId: 1,
  nodes: [
    { id: "small.ts", kind: "file", name: "small.ts" },
    { id: "big.ts", kind: "file", name: "big.ts" },
  ],
  edges: [{ srcId: "small.ts", dstId: "big.ts", kind: "imports" }],
  metrics: [
    { nodeId: "small.ts", name: "loc", value: 10, unit: "lines" },
    { nodeId: "big.ts", name: "loc", value: 1000, unit: "lines" },
    { nodeId: "small.ts", name: "cyclomatic_max", value: 2 },
    { nodeId: "big.ts", name: "cyclomatic_max", value: 28 },
  ],
};

describe("renderHtml metric overlays", () => {
  it("emits no overlay markers when no overlay options are passed", async () => {
    const html = await renderHtml(tinyGraphWithMetrics);
    expect(html).not.toContain('class="overlay-badge"');
    // Should not appear as a JSON value assignment in the cy data payload.
    expect(html).not.toMatch(/"overlay_fill":"#[0-9a-f]+"/);
  });

  it("emits an overlay badge in the header when --color-by is set", async () => {
    const html = await renderHtml(tinyGraphWithMetrics, {
      colorBy: "cyclomatic_max",
    });
    expect(html).toContain('class="overlay-badge"');
    expect(html).toContain("color: cyclomatic_max");
  });

  it("emits an overlay badge for --size-by", async () => {
    const html = await renderHtml(tinyGraphWithMetrics, { sizeBy: "loc" });
    expect(html).toContain("size: loc");
  });

  it("attaches an overlay_fill data field to each colored node", async () => {
    const html = await renderHtml(tinyGraphWithMetrics, {
      colorBy: "cyclomatic_max",
    });
    expect(html).toMatch(/"overlay_fill":"#[0-9a-f]+"/);
  });

  it("sizes the layout differently when --size-by is set", async () => {
    const plain = await renderHtml(tinyGraphWithMetrics);
    const sized = await renderHtml(tinyGraphWithMetrics, { sizeBy: "loc" });
    // The cy data carries explicit width/height per node — they should differ
    // between the plain and sized renders.
    const plainWidths = [...plain.matchAll(/"width":(\d+)/g)].map((m) => Number(m[1]));
    const sizedWidths = [...sized.matchAll(/"width":(\d+)/g)].map((m) => Number(m[1]));
    expect(plainWidths.every((w) => w === plainWidths[0])).toBe(true);
    expect(new Set(sizedWidths).size).toBeGreaterThan(1);
  });

  it("includes the metrics in the embedded raw payload for the side panel", async () => {
    const html = await renderHtml(tinyGraphWithMetrics);
    expect(html).toContain('"loc":10');
    expect(html).toContain('"cyclomatic_max":28');
  });

  it("emits the metric block helper in the client script", async () => {
    const html = await renderHtml(tinyGraphWithMetrics);
    expect(html).toContain("metricsBlock");
    expect(html).toContain("Metrics</h2>");
  });
});
