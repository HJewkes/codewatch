import { describe, it, expect } from "vitest";
import {
  aggregateChurn,
  aggregateChurnWindows,
  computeRecencyMetrics,
  computeRecencyWindows,
  entriesWithin,
  parseChurnLog,
  resolveRenamedPath,
  windowSuffix,
  type ChurnEntry,
  type ChurnWindow,
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

  it("parses commit headers with author + committer time and numstat lines", () => {
    const text = [
      "abc1234567890abcdef\tJohn Doe\t1700000000",
      "1\t2\tsrc/foo.ts",
      "3\t0\tsrc/bar.ts",
      "",
      "deadbeefcafebabe1234\tJane Smith\t1700086400",
      "5\t5\tsrc/baz.ts",
    ].join("\n");

    expect(parseChurnLog(text)).toEqual<ChurnEntry[]>([
      { commit: "abc1234567890abcdef", author: "John Doe", epoch: 1700000000, filePath: "src/foo.ts", added: 1, deleted: 2 },
      { commit: "abc1234567890abcdef", author: "John Doe", epoch: 1700000000, filePath: "src/bar.ts", added: 3, deleted: 0 },
      { commit: "deadbeefcafebabe1234", author: "Jane Smith", epoch: 1700086400, filePath: "src/baz.ts", added: 5, deleted: 5 },
    ]);
  });

  it("tolerates legacy 2-field headers (no committer time) with epoch 0", () => {
    const text = ["abc1234\tA", "1\t2\tfoo.ts"].join("\n");
    expect(parseChurnLog(text)).toEqual<ChurnEntry[]>([
      { commit: "abc1234", author: "A", epoch: 0, filePath: "foo.ts", added: 1, deleted: 2 },
    ]);
  });

  it("treats binary `-\\t-` lines as zero churn", () => {
    const text = ["abc1234\tA\t1700000000", "-\t-\tassets/logo.png"].join("\n");
    const out = parseChurnLog(text);
    expect(out).toEqual<ChurnEntry[]>([
      { commit: "abc1234", author: "A", epoch: 1700000000, filePath: "assets/logo.png", added: 0, deleted: 0 },
    ]);
  });

  it("ignores stray lines that don't match either shape", () => {
    const text = ["garbage line", "abc1234\tA\t1700000000", "1\t1\tfoo.ts", "more garbage"].join("\n");
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
    { commit: "c1", author: "alice", epoch: 0, filePath: "a.ts", added: 5, deleted: 3 },
    { commit: "c2", author: "alice", epoch: 0, filePath: "a.ts", added: 1, deleted: 1 },
    { commit: "c2", author: "alice", epoch: 0, filePath: "b.ts", added: 10, deleted: 0 },
    { commit: "c3", author: "bob", epoch: 0, filePath: "a.ts", added: 2, deleted: 2 },
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

describe("entriesWithin", () => {
  const DAY = 86400;
  const now = 1000 * DAY;
  const mk = (filePath: string, ageDays: number): ChurnEntry => ({
    commit: filePath,
    author: "a",
    epoch: now - ageDays * DAY,
    filePath,
    added: 1,
    deleted: 0,
  });
  const entries = [mk("recent.ts", 10), mk("mid.ts", 60), mk("old.ts", 150)];

  it("keeps only entries committed within the window", () => {
    expect(entriesWithin(entries, 30, now).map((e) => e.filePath)).toEqual(["recent.ts"]);
    expect(entriesWithin(entries, 90, now).map((e) => e.filePath)).toEqual(["recent.ts", "mid.ts"]);
    expect(entriesWithin(entries, 180, now).map((e) => e.filePath)).toEqual([
      "recent.ts",
      "mid.ts",
      "old.ts",
    ]);
  });
});

describe("aggregateChurnWindows", () => {
  const DAY = 86400;
  const now = 1000 * DAY;
  const mk = (filePath: string, ageDays: number, lines: number): ChurnEntry => ({
    commit: `${filePath}@${ageDays}`,
    author: "a",
    epoch: now - ageDays * DAY,
    filePath,
    added: lines,
    deleted: 0,
  });
  const entries = [mk("a.ts", 5, 3), mk("a.ts", 100, 7), mk("b.ts", 150, 4)];

  it("slices one wide log into per-window churn metrics", () => {
    const m = aggregateChurnWindows(entries, [30, 90, 180], now);
    const churn = (id: string, w: number) =>
      m.find((x) => x.nodeId === id && x.name === `churn_${w}d`)?.value;
    // a.ts churned 5d ago (in all windows) and 100d ago (only 180d).
    expect(churn("a.ts", 30)).toBe(3);
    expect(churn("a.ts", 90)).toBe(3);
    expect(churn("a.ts", 180)).toBe(10);
    // b.ts only churned 150d ago → present in 180d, absent in narrower windows.
    expect(churn("b.ts", 30)).toBeUndefined();
    expect(churn("b.ts", 180)).toBe(4);
  });

  it("aggregates ALL entries for the lifetime window regardless of age (C-71)", () => {
    const m = aggregateChurnWindows(entries, ["lifetime"], now);
    const churn = (id: string) =>
      m.find((x) => x.nodeId === id && x.name === "churn_lifetime")?.value;
    // Every entry counts — even b.ts's 150d-old commit and a.ts's 100d one —
    // because lifetime spans all of history with no `--since` bound.
    expect(churn("a.ts")).toBe(10); // 3 + 7
    expect(churn("b.ts")).toBe(4);
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
  const DAY = 86400;
  const now = 1000 * DAY;
  const recency = (m: ReturnType<typeof computeRecencyWindows>, id: string, w: number) =>
    m.find((x) => x.nodeId === id && x.name === `recency_${w}d`)?.value;

  it("discounts a file younger than a window, leaves older windows at 1, and emits age once", () => {
    const firstSeen = new Map([["f.ts", now - 45 * DAY]]);
    const byWindow = new Map<number, ReadonlySet<string>>([
      [30, new Set(["f.ts"])],
      [90, new Set(["f.ts"])],
      [180, new Set(["f.ts"])],
    ]);
    const m = computeRecencyWindows(firstSeen, byWindow, now);
    expect(recency(m, "f.ts", 30)).toBe(1); // age 45d ≥ 30d window
    expect(recency(m, "f.ts", 90)).toBe(0.5); // 45/90
    expect(recency(m, "f.ts", 180)).toBe(0.25); // 45/180
    expect(m.filter((x) => x.name === "file_age_days")).toHaveLength(1);
    expect(m.find((x) => x.name === "file_age_days")?.value).toBe(45);
  });

  it("defaults recency to 1 (no age discount) when first-seen is unknown", () => {
    const m = computeRecencyWindows(new Map(), new Map([[30, new Set(["ghost.ts"])]]), now);
    expect(recency(m, "ghost.ts", 30)).toBe(1);
    expect(m.some((x) => x.name === "file_age_days")).toBe(false);
  });

  it("never age-discounts the lifetime window even for a brand-new file (C-71)", () => {
    // A 1-day-old file would read as recency≈0 under an age/window ratio with a
    // huge window; lifetime forces recency=1 so its full churn scores, while
    // still emitting the (window-independent) file age.
    const firstSeen = new Map([["fresh.ts", now - 1 * DAY]]);
    const byWindow = new Map<ChurnWindow, ReadonlySet<string>>([
      ["lifetime", new Set(["fresh.ts"])],
    ]);
    const m = computeRecencyWindows(firstSeen, byWindow, now);
    expect(m.find((x) => x.nodeId === "fresh.ts" && x.name === "recency_lifetime")?.value).toBe(1);
    expect(m.find((x) => x.name === "file_age_days")?.value).toBe(1);
  });
});
