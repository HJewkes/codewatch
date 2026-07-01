import { describe, it, expect } from "vitest";
import {
  aggregateChurn,
  computeRecencyMetrics,
  parseChurnLog,
  resolveRenamedPath,
  type ChurnEntry,
} from "../churn.js";

describe("computeRecencyMetrics", () => {
  const DAY = 86400;
  const now = 1_000_000 * DAY; // arbitrary fixed "now" in epoch seconds

  const recency = (metrics: ReturnType<typeof computeRecencyMetrics>, id: string) =>
    metrics.find((m) => m.nodeId === id && m.name === "recency_30d")?.value;
  const age = (metrics: ReturnType<typeof computeRecencyMetrics>, id: string) =>
    metrics.find((m) => m.nodeId === id && m.name === "file_age_days")?.value;

  it("discounts a file younger than the window proportionally", () => {
    const seen = new Map([["new.ts", now - 6 * DAY]]); // 6 days old, window 30
    const m = computeRecencyMetrics(seen, ["new.ts"], 30, now);
    expect(recency(m, "new.ts")).toBeCloseTo(0.2, 5); // 6/30
    expect(age(m, "new.ts")).toBe(6);
  });

  it("does not discount a file older than the window (recency = 1)", () => {
    const seen = new Map([["old.ts", now - 200 * DAY]]);
    const m = computeRecencyMetrics(seen, ["old.ts"], 30, now);
    expect(recency(m, "old.ts")).toBe(1);
    expect(age(m, "old.ts")).toBe(200);
  });

  it("emits recency=1 (no age) for a churned file with an unknown first-seen date", () => {
    // Guarantees the scary-hotspots rule, which requires all factors, never goes
    // silent when git can't supply an age.
    const m = computeRecencyMetrics(new Map(), ["ghost.ts"], 30, now);
    expect(recency(m, "ghost.ts")).toBe(1);
    expect(age(m, "ghost.ts")).toBeUndefined();
  });
});

describe("parseChurnLog", () => {
  it("returns empty for empty input", () => {
    expect(parseChurnLog("")).toEqual([]);
  });

  it("parses commit headers and following numstat lines", () => {
    const text = [
      "abc1234567890abcdef\tJohn Doe",
      "1\t2\tsrc/foo.ts",
      "3\t0\tsrc/bar.ts",
      "",
      "deadbeefcafebabe1234\tJane Smith",
      "5\t5\tsrc/baz.ts",
    ].join("\n");

    expect(parseChurnLog(text)).toEqual<ChurnEntry[]>([
      { commit: "abc1234567890abcdef", author: "John Doe", filePath: "src/foo.ts", added: 1, deleted: 2 },
      { commit: "abc1234567890abcdef", author: "John Doe", filePath: "src/bar.ts", added: 3, deleted: 0 },
      { commit: "deadbeefcafebabe1234", author: "Jane Smith", filePath: "src/baz.ts", added: 5, deleted: 5 },
    ]);
  });

  it("treats binary `-\\t-` lines as zero churn", () => {
    const text = ["abc1234\tA", "-\t-\tassets/logo.png"].join("\n");
    const out = parseChurnLog(text);
    expect(out).toEqual<ChurnEntry[]>([
      { commit: "abc1234", author: "A", filePath: "assets/logo.png", added: 0, deleted: 0 },
    ]);
  });

  it("ignores stray lines that don't match either shape", () => {
    const text = ["garbage line", "abc1234\tA", "1\t1\tfoo.ts", "more garbage"].join("\n");
    expect(parseChurnLog(text)).toHaveLength(1);
  });

  it("attributes renamed files to their new path", () => {
    const text = [
      "abc1234\tA",
      "0\t0\tsrc/{old.ts => new.ts}",
      "0\t0\told/path.ts => new/path.ts",
    ].join("\n");
    const out = parseChurnLog(text);
    expect(out.map((e) => e.filePath)).toEqual(["src/new.ts", "new/path.ts"]);
  });
});

describe("resolveRenamedPath", () => {
  it("passes through plain paths", () => {
    expect(resolveRenamedPath("src/foo.ts")).toBe("src/foo.ts");
  });

  it("resolves brace renames preserving prefix and suffix", () => {
    expect(resolveRenamedPath("src/{old.ts => new.ts}")).toBe("src/new.ts");
    expect(resolveRenamedPath("a/{b => c}/d.ts")).toBe("a/c/d.ts");
  });

  it("resolves arrow renames without braces", () => {
    expect(resolveRenamedPath("old.ts => new.ts")).toBe("new.ts");
    expect(resolveRenamedPath("a/b/old.ts => x/y/new.ts")).toBe("x/y/new.ts");
  });

  it("collapses double slashes from empty segments in brace renames", () => {
    expect(resolveRenamedPath("a/{old => }/b.ts")).toBe("a/b.ts");
  });
});

describe("aggregateChurn", () => {
  const entries: ChurnEntry[] = [
    { commit: "c1", author: "alice", filePath: "a.ts", added: 5, deleted: 3 },
    { commit: "c2", author: "alice", filePath: "a.ts", added: 1, deleted: 1 },
    { commit: "c2", author: "alice", filePath: "b.ts", added: 10, deleted: 0 },
    { commit: "c3", author: "bob", filePath: "a.ts", added: 2, deleted: 2 },
  ];

  it("sums added+deleted into churn_<window>", () => {
    const m = aggregateChurn(entries, 30);
    const churnA = m.find((x) => x.nodeId === "a.ts" && x.name === "churn_30d");
    expect(churnA?.value).toBe(5 + 3 + 1 + 1 + 2 + 2);
  });

  it("counts distinct commits per file", () => {
    const m = aggregateChurn(entries, 30);
    const commits = m.find((x) => x.nodeId === "a.ts" && x.name === "churn_30d_commits");
    expect(commits?.value).toBe(3);
  });

  it("counts distinct authors per file", () => {
    const m = aggregateChurn(entries, 30);
    const authors = m.find((x) => x.nodeId === "a.ts" && x.name === "churn_30d_authors");
    expect(authors?.value).toBe(2);
  });

  it("uses the window in the metric name", () => {
    const m = aggregateChurn(entries, 7);
    expect(m.some((x) => x.name === "churn_7d")).toBe(true);
    expect(m.some((x) => x.name === "churn_7d_commits")).toBe(true);
    expect(m.some((x) => x.name === "churn_7d_authors")).toBe(true);
  });

  it("filters to known file ids when provided", () => {
    const m = aggregateChurn(entries, 30, new Set(["a.ts"]));
    const ids = new Set(m.map((x) => x.nodeId));
    expect(ids).toEqual(new Set(["a.ts"]));
  });

  it("emits no metrics when no entries match the known set", () => {
    expect(aggregateChurn(entries, 30, new Set(["c.ts"]))).toEqual([]);
  });
});
