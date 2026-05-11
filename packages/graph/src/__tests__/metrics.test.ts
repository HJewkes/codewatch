import { describe, it, expect } from "vitest";
import { computeMetrics } from "../metrics.js";
import type { GraphEdge, GraphNode } from "../types.js";

function file(id: string): GraphNode {
  return { id, kind: "file", name: id };
}

function imports(srcId: string, dstId: string): GraphEdge {
  return { srcId, dstId, kind: "imports" };
}

function findMetric(
  metrics: ReturnType<typeof computeMetrics>,
  nodeId: string,
  name: string,
): number | null | undefined {
  return metrics.find((m) => m.nodeId === nodeId && m.name === name)?.value;
}

describe("computeMetrics", () => {
  it("emits fan_in=0 and fan_out=0 for an isolated node, and skips instability", () => {
    const metrics = computeMetrics([file("a")], []);
    expect(findMetric(metrics, "a", "fan_in")).toBe(0);
    expect(findMetric(metrics, "a", "fan_out")).toBe(0);
    expect(findMetric(metrics, "a", "instability")).toBeUndefined();
  });

  it("counts a→b as fan_out=1 on a, fan_in=1 on b", () => {
    const metrics = computeMetrics(
      [file("a"), file("b")],
      [imports("a", "b")],
    );
    expect(findMetric(metrics, "a", "fan_in")).toBe(0);
    expect(findMetric(metrics, "a", "fan_out")).toBe(1);
    expect(findMetric(metrics, "b", "fan_in")).toBe(1);
    expect(findMetric(metrics, "b", "fan_out")).toBe(0);
  });

  it("computes instability = fan_out / (fan_in + fan_out)", () => {
    const metrics = computeMetrics(
      [file("a"), file("b"), file("c")],
      [imports("a", "b"), imports("a", "c"), imports("c", "b")],
    );
    // a: fan_in=0, fan_out=2 → I = 2/2 = 1.0 (max unstable)
    expect(findMetric(metrics, "a", "instability")).toBe(1);
    // c: fan_in=1, fan_out=1 → I = 0.5
    expect(findMetric(metrics, "c", "instability")).toBe(0.5);
    // b: fan_in=2, fan_out=0 → I = 0 (max stable)
    expect(findMetric(metrics, "b", "instability")).toBe(0);
  });

  it("counts every edge regardless of kind", () => {
    const metrics = computeMetrics(
      [file("a"), file("b")],
      [
        { srcId: "a", dstId: "b", kind: "imports" },
        { srcId: "a", dstId: "b", kind: "re-exports" },
      ],
    );
    expect(findMetric(metrics, "a", "fan_out")).toBe(2);
    expect(findMetric(metrics, "b", "fan_in")).toBe(2);
  });

  it("ignores edges that reference nodes not in the node set", () => {
    const metrics = computeMetrics([file("a")], [imports("a", "phantom")]);
    expect(findMetric(metrics, "a", "fan_out")).toBe(1);
    expect(metrics.some((m) => m.nodeId === "phantom")).toBe(false);
  });

  it("tags fan_in/fan_out with unit='count' and instability with unit='ratio'", () => {
    const metrics = computeMetrics(
      [file("a"), file("b")],
      [imports("a", "b")],
    );
    const fanIn = metrics.find((m) => m.nodeId === "a" && m.name === "fan_in")!;
    const inst = metrics.find((m) => m.nodeId === "a" && m.name === "instability")!;
    expect(fanIn.unit).toBe("count");
    expect(inst.unit).toBe("ratio");
  });
});
