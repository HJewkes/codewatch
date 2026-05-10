import { describe, it, expect, vi } from "vitest";
import { computeLayout } from "../layout.js";
import type { RenderInput } from "../types.js";

const tinyGraph: RenderInput = {
  snapshotId: 1,
  nodes: [
    { id: "a.ts", kind: "file", name: "a.ts" },
    { id: "b.ts", kind: "file", name: "b.ts" },
    { id: "c.ts", kind: "file", name: "c.ts" },
  ],
  edges: [
    { srcId: "a.ts", dstId: "b.ts", kind: "imports" },
    { srcId: "b.ts", dstId: "c.ts", kind: "imports" },
  ],
};

describe("computeLayout", () => {
  it("returns finite coordinates for every node via ELK", async () => {
    const result = await computeLayout(tinyGraph);
    expect(result.nodes).toHaveLength(3);
    for (const n of result.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
  });

  it("preserves edges", async () => {
    const result = await computeLayout(tinyGraph);
    expect(result.edges).toEqual(tinyGraph.edges);
  });

  it("handles an empty graph", async () => {
    const result = await computeLayout({ snapshotId: 1, nodes: [], edges: [] });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("falls back to a grid when ELK throws", async () => {
    // Force the ELK path to fail by stubbing the module.
    vi.resetModules();
    vi.doMock("elkjs/lib/elk.bundled.js", () => {
      return {
        default: class FakeElk {
          layout(): Promise<unknown> {
            return Promise.reject(new Error("synthetic ELK failure"));
          }
        },
      };
    });
    const mod = await import("../layout.js");
    const result = await mod.computeLayout(tinyGraph);
    expect(result.nodes).toHaveLength(3);
    for (const n of result.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    // Grid fallback places nodes on a deterministic lattice — distinct x or y per node.
    const positions = result.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(positions).size).toBe(3);
    vi.doUnmock("elkjs/lib/elk.bundled.js");
    vi.resetModules();
  });
});
