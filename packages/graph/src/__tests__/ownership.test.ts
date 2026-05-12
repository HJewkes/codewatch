import { describe, it, expect } from "vitest";
import { computeOwnershipMetrics } from "../ownership.js";
import type { ChurnEntry } from "../churn.js";

function entry(
  commit: string,
  author: string,
  filePath: string,
  lines: number,
): ChurnEntry {
  return { commit, author, filePath, added: lines, deleted: 0 };
}

function findMetric(
  metrics: ReturnType<typeof computeOwnershipMetrics>,
  nodeId: string,
  name: string,
): number | null | undefined {
  return metrics.find((m) => m.nodeId === nodeId && m.name === name)?.value;
}

describe("computeOwnershipMetrics", () => {
  it("emits bus_factor=1 and top_author_share=1 for a single-author file", () => {
    const metrics = computeOwnershipMetrics([
      entry("c1", "alice", "a.ts", 10),
      entry("c2", "alice", "a.ts", 20),
    ]);
    expect(findMetric(metrics, "a.ts", "bus_factor_30d")).toBe(1);
    expect(findMetric(metrics, "a.ts", "top_author_share_30d")).toBe(1);
  });

  it("computes bus_factor at the 50%-threshold by default", () => {
    // alice: 60 lines, bob: 30, carol: 10. Total=100.
    // Top author share = 0.6. Bus factor: alice alone clears 50% → 1.
    const metrics = computeOwnershipMetrics([
      entry("c1", "alice", "a.ts", 60),
      entry("c2", "bob", "a.ts", 30),
      entry("c3", "carol", "a.ts", 10),
    ]);
    expect(findMetric(metrics, "a.ts", "bus_factor_30d")).toBe(1);
    expect(findMetric(metrics, "a.ts", "top_author_share_30d")).toBe(0.6);
  });

  it("requires two authors when top author is under 50%", () => {
    // alice: 40, bob: 30, carol: 30. Total=100.
    // Bus factor: alice alone = 0.4 (no), alice+bob = 0.7 (yes) → 2.
    const metrics = computeOwnershipMetrics([
      entry("c1", "alice", "a.ts", 40),
      entry("c2", "bob", "a.ts", 30),
      entry("c3", "carol", "a.ts", 30),
    ]);
    expect(findMetric(metrics, "a.ts", "bus_factor_30d")).toBe(2);
    expect(findMetric(metrics, "a.ts", "top_author_share_30d")).toBe(0.4);
  });

  it("respects --busFactorThreshold (e.g. 80%)", () => {
    // alice: 60, bob: 30, carol: 10. Total=100.
    // Threshold 0.8: alice (0.6, no), alice+bob (0.9, yes) → 2.
    const metrics = computeOwnershipMetrics(
      [
        entry("c1", "alice", "a.ts", 60),
        entry("c2", "bob", "a.ts", 30),
        entry("c3", "carol", "a.ts", 10),
      ],
      { busFactorThreshold: 0.8 },
    );
    expect(findMetric(metrics, "a.ts", "bus_factor_30d")).toBe(2);
  });

  it("uses the configured windowDays in metric names", () => {
    const metrics = computeOwnershipMetrics(
      [entry("c1", "alice", "a.ts", 10)],
      { windowDays: 90 },
    );
    expect(metrics.find((m) => m.name === "bus_factor_90d")?.value).toBe(1);
    expect(
      metrics.find((m) => m.name === "top_author_share_90d")?.value,
    ).toBe(1);
  });

  it("filters by knownFileIds", () => {
    const metrics = computeOwnershipMetrics(
      [
        entry("c1", "alice", "a.ts", 10),
        entry("c2", "alice", "untracked.ts", 10),
      ],
      { knownFileIds: new Set(["a.ts"]) },
    );
    expect(metrics.some((m) => m.nodeId === "untracked.ts")).toBe(false);
    expect(metrics.some((m) => m.nodeId === "a.ts")).toBe(true);
  });

  it("skips files with zero total churn", () => {
    const metrics = computeOwnershipMetrics([
      { commit: "c1", author: "alice", filePath: "a.ts", added: 0, deleted: 0 },
    ]);
    expect(metrics).toEqual([]);
  });

  it("counts unique author identities by email for bus_factor", () => {
    // ChurnEntry.author holds git's %ae (email). Real repos have spelling
    // drift on display names ("Henry Jewkes" vs "hjewkes" vs bot variants),
    // but the email stays stable — so 5 commits from alice@ and 2 from bob@
    // should resolve to exactly 2 distinct authors regardless of name churn.
    const entries: ChurnEntry[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        entry(`a${i}`, "alice@example.com", "f.ts", 10),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        entry(`b${i}`, "bob@example.com", "f.ts", 10),
      ),
    ];
    const metrics = computeOwnershipMetrics(entries, {
      busFactorThreshold: 0.99,
    });
    // alice: 50 lines, bob: 20. Threshold 0.99 forces both to be counted.
    expect(findMetric(metrics, "f.ts", "bus_factor_30d")).toBe(2);
  });

  it("rounds top_author_share to 3 decimals", () => {
    // 1/3 = 0.3333… → 0.333
    const metrics = computeOwnershipMetrics([
      entry("c1", "alice", "a.ts", 1),
      entry("c2", "bob", "a.ts", 1),
      entry("c3", "carol", "a.ts", 1),
    ]);
    expect(findMetric(metrics, "a.ts", "top_author_share_30d")).toBe(0.333);
  });
});
