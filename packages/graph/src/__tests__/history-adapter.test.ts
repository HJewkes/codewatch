// Copy of @titan-design/code-graph's history-recency.test.ts and history-metrics.test.ts at titan-platform 6b1876a; delete with ../history-adapter.ts.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { aggregateChurn, type ChurnEntry, type ChurnWindow } from "@titan-design/code-graph/history";
import type { TestSourceLink } from "../test-linker.js";
import {
  churnMetrics,
  computeRecencyWindows,
  computeTestCoverageOwnership,
  ownershipMetrics,
  resolveChurnWindows,
  windowSuffix,
} from "../history-adapter.js";
import type { GraphMetric } from "../types.js";

const DAY = 86400;

const valueOf = (metrics: GraphMetric[], id: string, name: string) =>
  metrics.find((m) => m.nodeId === id && m.name === name)?.value;

describe("computeRecencyWindows for one window", () => {
  const now = 1_000_000 * DAY;
  const single = (seen: Map<string, number>, id: string) =>
    computeRecencyWindows(seen, new Map([[30, new Set([id])]]), now);

  it("discounts a file younger than the window proportionally", () => {
    const m = single(new Map([["new.ts", now - 6 * DAY]]), "new.ts");
    expect(valueOf(m, "new.ts", "recency_30d")).toBeCloseTo(0.2, 5);
    expect(valueOf(m, "new.ts", "file_age_days")).toBe(6);
  });

  it("does not discount a file older than the window (recency = 1)", () => {
    const m = single(new Map([["old.ts", now - 200 * DAY]]), "old.ts");
    expect(valueOf(m, "old.ts", "recency_30d")).toBe(1);
    expect(valueOf(m, "old.ts", "file_age_days")).toBe(200);
  });

  it("emits recency=1 (no age) for a churned file with an unknown first-seen date", () => {
    const m = single(new Map(), "ghost.ts");
    expect(valueOf(m, "ghost.ts", "recency_30d")).toBe(1);
    expect(valueOf(m, "ghost.ts", "file_age_days")).toBeUndefined();
  });
});

describe("windowSuffix", () => {
  it("maps a day count to `<n>d` and lifetime to `lifetime`", () => {
    expect(windowSuffix(30)).toBe("30d");
    expect(windowSuffix(180)).toBe("180d");
    expect(windowSuffix("lifetime")).toBe("lifetime");
  });
});

describe("computeRecencyWindows", () => {
  const now = 1000 * DAY;

  it("discounts a file younger than a window, leaves older windows at 1, and emits age once", () => {
    const byWindow = new Map<number, ReadonlySet<string>>([
      [30, new Set(["f.ts"])],
      [90, new Set(["f.ts"])],
      [180, new Set(["f.ts"])],
    ]);
    const m = computeRecencyWindows(new Map([["f.ts", now - 45 * DAY]]), byWindow, now);
    expect(valueOf(m, "f.ts", "recency_30d")).toBe(1);
    expect(valueOf(m, "f.ts", "recency_90d")).toBe(0.5);
    expect(valueOf(m, "f.ts", "recency_180d")).toBe(0.25);
    expect(m.filter((x) => x.name === "file_age_days")).toHaveLength(1);
    expect(valueOf(m, "f.ts", "file_age_days")).toBe(45);
  });

  it("defaults recency to 1 (no age discount) when first-seen is unknown", () => {
    const m = computeRecencyWindows(new Map(), new Map([[30, new Set(["ghost.ts"])]]), now);
    expect(valueOf(m, "ghost.ts", "recency_30d")).toBe(1);
    expect(m.some((x) => x.name === "file_age_days")).toBe(false);
  });

  it("never age-discounts the lifetime window even for a brand-new file", () => {
    const byWindow = new Map<ChurnWindow, ReadonlySet<string>>([["lifetime", new Set(["fresh.ts"])]]);
    const m = computeRecencyWindows(new Map([["fresh.ts", now - 1 * DAY]]), byWindow, now);
    expect(valueOf(m, "fresh.ts", "recency_lifetime")).toBe(1);
    expect(valueOf(m, "fresh.ts", "file_age_days")).toBe(1);
  });
});

function entry(commit: string, author: string, filePath: string, lines: number): ChurnEntry {
  return { commit, author, epoch: 0, filePath, added: lines, deleted: 0 };
}

describe("churnMetrics", () => {
  it("uses the window in the metric name", () => {
    const m = churnMetrics(new Map([[7, aggregateChurn([entry("c1", "a", "a.ts", 2)])]]));
    expect(m.map((x) => x.name)).toEqual(["churn_7d", "churn_7d_commits", "churn_7d_authors"]);
  });
});

describe("ownershipMetrics", () => {
  it("suffixes lifetime ownership metrics with `lifetime`", () => {
    const m = ownershipMetrics(
      [entry("c1", "alice", "a.ts", 40), entry("c2", "bob", "a.ts", 40), entry("c3", "carol", "a.ts", 20)],
      "lifetime",
    );
    expect(valueOf(m, "a.ts", "bus_factor_lifetime")).toBe(2);
    expect(valueOf(m, "a.ts", "top_author_share_lifetime")).toBe(0.4);
    expect(valueOf(m, "a.ts", "bus_factor_30d")).toBeUndefined();
  });

  it("uses the configured window in metric names", () => {
    const m = ownershipMetrics([entry("c1", "alice", "a.ts", 10)], 90);
    expect(valueOf(m, "a.ts", "bus_factor_90d")).toBe(1);
    expect(valueOf(m, "a.ts", "top_author_share_90d")).toBe(1);
  });

  it("rounds top_author_share to 3 decimals", () => {
    const m = ownershipMetrics(
      [entry("c1", "alice", "a.ts", 1), entry("c2", "bob", "a.ts", 1), entry("c3", "carol", "a.ts", 1)],
      30,
    );
    expect(valueOf(m, "a.ts", "top_author_share_30d")).toBe(0.333);
  });
});

describe("resolveChurnWindows", () => {
  it("adds the primary window to the defaults, sorted, with lifetime last when requested", () => {
    expect(resolveChurnWindows(undefined, 7, false)).toEqual([7, 30, 90, 180]);
    expect(resolveChurnWindows([30], 30, true)).toEqual([30, "lifetime"]);
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
    expect(valueOf(metrics, "a.ts", "test_bus_factor_30d")).toBe(1);
    expect(valueOf(metrics, "a.ts", "test_top_author_share_30d")).toBe(1);
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
    const prod = ownershipMetrics(churn, 30, new Set(["svc.ts"]));
    const cover = computeTestCoverageOwnership(churn, [pathLink("svc.test.ts", "svc.ts")]);
    expect(valueOf(prod, "svc.ts", "bus_factor_30d")).toBe(2);
    expect(valueOf(cover, "svc.ts", "test_bus_factor_30d")).toBe(1);
  });

  it("aggregates authorship across all tests linked to one source", () => {
    // Two test files cover svc.ts: alice owns one, bob the other → spread.
    const churn = [entry("t1", "alice", "svc.a.test.ts", 40), entry("t2", "bob", "svc.b.test.ts", 40)];
    const metrics = computeTestCoverageOwnership(
      churn,
      [pathLink("svc.a.test.ts", "svc.ts"), pathLink("svc.b.test.ts", "svc.ts")],
      { busFactorThreshold: 0.5 },
    );
    // alice 40, bob 40 → top author alone is 0.5 → bus factor 1 at threshold.
    expect(valueOf(metrics, "svc.ts", "test_top_author_share_30d")).toBe(0.5);
  });

  it("sums one author's churn across every test linked to the source", () => {
    const churn = [
      entry("t1", "alice", "svc.a.test.ts", 20),
      entry("t2", "alice", "svc.b.test.ts", 20),
      entry("t3", "bob", "svc.b.test.ts", 30),
    ];
    const links = [pathLink("svc.a.test.ts", "svc.ts"), pathLink("svc.b.test.ts", "svc.ts")];
    expect(valueOf(computeTestCoverageOwnership(churn, links), "svc.ts", "test_top_author_share_30d")).toBe(0.571);
  });

  it("needs two test authors when none clears the default 50% threshold", () => {
    const churn = [
      entry("t1", "alice", "a.test.ts", 40),
      entry("t2", "bob", "a.test.ts", 30),
      entry("t3", "carol", "a.test.ts", 30),
    ];
    expect(valueOf(computeTestCoverageOwnership(churn, [pathLink("a.test.ts", "a.ts")]), "a.ts", "test_bus_factor_30d")).toBe(2);
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
    expect(valueOf(metrics, "a.ts", "test_bus_factor_90d")).toBe(1);
  });
});

// Guards codewatch-side edits to the copy; drift on the titan-platform side is TP-250's concern.
describe("history-adapter.ts is an unedited copy", () => {
  it("still hashes to the body copied from titan-platform 6b1876a", () => {
    const file = new URL("../history-adapter.ts", import.meta.url);
    const body = readFileSync(file, "utf8").split("\n").slice(1).join("\n");
    expect(
      createHash("sha256").update(body).digest("hex"),
      "history-adapter.ts is a verbatim copy of @titan-design/code-graph's history-recency.ts and " +
        "history-metrics.ts at titan-platform 6b1876a. Do not edit it. Delete it, with this test and " +
        "the copied cases above, once TP-250 exports loadHistoryMetrics from the package root.",
    ).toBe("3bd4f0f8cda13f47af8694e50204f2dd44d0c7ef06e4767642d1f34669b00ac6");
  });
});
