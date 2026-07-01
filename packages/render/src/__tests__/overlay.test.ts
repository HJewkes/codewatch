import { describe, it, expect } from "vitest";
import { computeOverlays, buildMetricMap, rampColor } from "../overlay.js";
import type { GraphMetric, GraphNode } from "@codewatch/graph";

const file = (id: string): GraphNode => ({ id, kind: "file", name: id });

describe("buildMetricMap", () => {
  it("groups metrics by node id", () => {
    const map = buildMetricMap([
      { nodeId: "a", name: "loc", value: 10 },
      { nodeId: "a", name: "fan_in", value: 3 },
      { nodeId: "b", name: "loc", value: 50 },
    ]);
    expect(map.get("a")?.get("loc")).toBe(10);
    expect(map.get("a")?.get("fan_in")).toBe(3);
    expect(map.get("b")?.get("loc")).toBe(50);
  });

  it("ignores null-valued metrics", () => {
    const map = buildMetricMap([{ nodeId: "a", name: "loc", value: null }]);
    expect(map.get("a")).toBeUndefined();
  });
});

describe("rampColor", () => {
  it("returns the cold endpoint at t=0", () => {
    expect(rampColor(0)).toBe("#268e69");
  });

  it("returns the hot endpoint at t=1", () => {
    expect(rampColor(1)).toBe("#d95757");
  });

  it("returns the mid endpoint at t=0.5", () => {
    expect(rampColor(0.5)).toBe("#dcb256");
  });

  it("interpolates between endpoints", () => {
    const result = rampColor(0.25);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    expect(result).not.toBe("#268e69");
    expect(result).not.toBe("#dcb256");
  });
});

describe("computeOverlays — sizing", () => {
  const nodes = [file("small"), file("med"), file("big")];
  const metrics: GraphMetric[] = [
    { nodeId: "small", name: "loc", value: 10 },
    { nodeId: "med", name: "loc", value: 100 },
    { nodeId: "big", name: "loc", value: 1000 },
  ];

  it("returns null when no overlay options are set", () => {
    const out = computeOverlays(nodes, metrics, {});
    expect(out.sizing).toBeNull();
    expect(out.fills).toBeNull();
  });

  it("returns null when metrics array is empty", () => {
    const out = computeOverlays(nodes, [], { sizeBy: "loc" });
    expect(out.sizing).toBeNull();
  });

  it("scales node dimensions monotonically with metric value", () => {
    const out = computeOverlays(nodes, metrics, { sizeBy: "loc" });
    expect(out.sizing).not.toBeNull();
    const small = out.sizing!.get("small")!;
    const med = out.sizing!.get("med")!;
    const big = out.sizing!.get("big")!;
    expect(small.width).toBeLessThan(med.width);
    expect(med.width).toBeLessThan(big.width);
    expect(small.height).toBeLessThan(med.height);
    expect(med.height).toBeLessThan(big.height);
  });

  it("falls back to default dimensions for nodes missing the metric", () => {
    const out = computeOverlays(
      [file("a"), file("b")],
      [{ nodeId: "a", name: "loc", value: 50 }],
      { sizeBy: "loc" },
    );
    const a = out.sizing!.get("a")!;
    const b = out.sizing!.get("b")!;
    // a uses sizing; b uses defaults (180×48).
    expect(b.width).toBe(180);
    expect(b.height).toBe(48);
    expect(a.width).not.toBe(180);
  });
});

describe("computeOverlays — color-by", () => {
  const nodes = [file("low"), file("high")];
  const metrics: GraphMetric[] = [
    { nodeId: "low", name: "cyclomatic_max", value: 1 },
    { nodeId: "high", name: "cyclomatic_max", value: 30 },
  ];

  it("emits a hex color per node", () => {
    const out = computeOverlays(nodes, metrics, { colorBy: "cyclomatic_max" });
    expect(out.fills?.get("low")).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.fills?.get("high")).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.fills?.get("low")).not.toBe(out.fills?.get("high"));
  });

  it("maps the lowest value to cold and the highest to hot", () => {
    const out = computeOverlays(nodes, metrics, { colorBy: "cyclomatic_max" });
    expect(out.fills?.get("low")).toBe("#268e69");
    expect(out.fills?.get("high")).toBe("#d95757");
  });

  it("omits fill for nodes missing the metric", () => {
    const out = computeOverlays(
      [file("a"), file("b")],
      [{ nodeId: "a", name: "loc", value: 5 }],
      { colorBy: "loc" },
    );
    expect(out.fills?.has("a")).toBe(true);
    expect(out.fills?.has("b")).toBe(false);
  });
});

describe("computeOverlays — sizeBy + colorBy together", () => {
  it("computes both maps independently", () => {
    const nodes = [file("a"), file("b")];
    const metrics: GraphMetric[] = [
      { nodeId: "a", name: "loc", value: 10 },
      { nodeId: "b", name: "loc", value: 100 },
      { nodeId: "a", name: "cyclomatic_max", value: 1 },
      { nodeId: "b", name: "cyclomatic_max", value: 20 },
    ];
    const out = computeOverlays(nodes, metrics, {
      sizeBy: "loc",
      colorBy: "cyclomatic_max",
    });
    expect(out.sizing).not.toBeNull();
    expect(out.fills).not.toBeNull();
    expect(out.sizeBy).toBe("loc");
    expect(out.colorBy).toBe("cyclomatic_max");
  });
});
