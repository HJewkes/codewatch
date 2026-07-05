import { describe, it, expect } from "vitest";
import {
  computeOwnershipMetrics,
  computeTestCoverageOwnership,
} from "../ownership.js";
import type { TestSourceLink } from "../test-linker.js";
import type { ChurnEntry } from "../churn.js";

function entry(
  commit: string,
  author: string,
  filePath: string,
  lines: number,
): ChurnEntry {
  return { commit, author, epoch: 0, filePath, added: lines, deleted: 0 };
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

  it("suffixes lifetime ownership metrics with `lifetime` (C-71)", () => {
    // Full-history bus factor = dominant-owner over all of git history. No single
    // author clears 50% (40/40/20) → two authors needed → bus_factor 2.
    const metrics = computeOwnershipMetrics(
      [
        entry("c1", "alice", "a.ts", 40),
        entry("c2", "bob", "a.ts", 40),
        entry("c3", "carol", "a.ts", 20),
      ],
      { windowDays: "lifetime" },
    );
    expect(findMetric(metrics, "a.ts", "bus_factor_lifetime")).toBe(2);
    expect(findMetric(metrics, "a.ts", "top_author_share_lifetime")).toBe(0.4);
    // The windowed suffix must NOT be emitted under lifetime.
    expect(findMetric(metrics, "a.ts", "bus_factor_30d")).toBeUndefined();
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
      { commit: "c1", author: "alice", epoch: 0, filePath: "a.ts", added: 0, deleted: 0 },
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

function pathLink(testId: string, sourceId: string): TestSourceLink {
  return { testId, sourceId, method: "path" };
}

describe("computeTestCoverageOwnership", () => {
  it("keys test-coverage bus-factor on the source node", () => {
    // a.ts is production code; a.test.ts is its single-author test.
    const metrics = computeTestCoverageOwnership(
      [entry("c1", "alice", "a.test.ts", 30)],
      [pathLink("a.test.ts", "a.ts")],
    );
    expect(findMetric(metrics, "a.ts", "test_bus_factor_30d")).toBe(1);
    expect(findMetric(metrics, "a.ts", "test_top_author_share_30d")).toBe(1);
    // It does NOT key on the test file itself.
    expect(metrics.some((m) => m.nodeId === "a.test.ts")).toBe(false);
  });

  it("splits production-spread from test-silo for the same source", () => {
    // Production churn spread three ways (top author 0.4 < 0.5 → bus factor 2).
    // But the tests are alice-only — a single-author test silo despite the
    // well-spread prod code.
    const churn = [
      entry("p1", "alice", "svc.ts", 40),
      entry("p2", "bob", "svc.ts", 30),
      entry("p3", "carol", "svc.ts", 30),
      entry("t1", "alice", "svc.test.ts", 40),
    ];
    const prod = computeOwnershipMetrics(churn, {
      knownFileIds: new Set(["svc.ts"]),
    });
    const cover = computeTestCoverageOwnership(churn, [
      pathLink("svc.test.ts", "svc.ts"),
    ]);
    expect(findMetric(prod, "svc.ts", "bus_factor_30d")).toBe(2);
    expect(findMetric(cover, "svc.ts", "test_bus_factor_30d")).toBe(1);
  });

  it("aggregates authorship across all tests linked to one source", () => {
    // Two test files cover svc.ts: alice owns one, bob the other → spread.
    const churn = [
      entry("t1", "alice", "svc.a.test.ts", 40),
      entry("t2", "bob", "svc.b.test.ts", 40),
    ];
    const metrics = computeTestCoverageOwnership(
      churn,
      [pathLink("svc.a.test.ts", "svc.ts"), pathLink("svc.b.test.ts", "svc.ts")],
      { busFactorThreshold: 0.5 },
    );
    // alice 40, bob 40 → top author alone is 0.5 → bus factor 1 at threshold.
    expect(findMetric(metrics, "svc.ts", "test_top_author_share_30d")).toBe(0.5);
  });

  it("emits nothing for a source whose linked tests have no churn", () => {
    const metrics = computeTestCoverageOwnership(
      [entry("c1", "alice", "unrelated.ts", 10)],
      [pathLink("a.test.ts", "a.ts")],
    );
    expect(metrics).toEqual([]);
  });

  it("respects the configured windowDays in metric names", () => {
    const metrics = computeTestCoverageOwnership(
      [entry("c1", "alice", "a.test.ts", 10)],
      [pathLink("a.test.ts", "a.ts")],
      { windowDays: 90 },
    );
    expect(findMetric(metrics, "a.ts", "test_bus_factor_90d")).toBe(1);
  });
});
