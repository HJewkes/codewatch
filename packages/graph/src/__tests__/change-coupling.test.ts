import { describe, it, expect } from "vitest";
import {
  computeChangeCoupling,
  couplingFor,
} from "../change-coupling.js";
import type { ChurnEntry } from "../churn.js";

function entry(commit: string, filePath: string): ChurnEntry {
  return { commit, author: "alice", epoch: 0, filePath, added: 1, deleted: 0 };
}

describe("computeChangeCoupling", () => {
  it("returns no pairs when no commits touch >=2 files", () => {
    const { pairs, skippedLargeCommits } = computeChangeCoupling([
      entry("c1", "a.ts"),
      entry("c2", "b.ts"),
    ]);
    expect(pairs).toEqual([]);
    expect(skippedLargeCommits).toBe(0);
  });

  it("counts each commit that touched both files in a pair", () => {
    const { pairs } = computeChangeCoupling([
      entry("c1", "a.ts"),
      entry("c1", "b.ts"),
      entry("c2", "a.ts"),
      entry("c2", "b.ts"),
      entry("c3", "a.ts"),
      entry("c3", "b.ts"),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ fileA: "a.ts", fileB: "b.ts", count: 3 });
    expect(pairs[0]!.commits).toEqual(["c1", "c2", "c3"]);
  });

  it("dedupes per-commit file mentions", () => {
    // Same file appears twice in one commit (e.g. multiple hunks).
    const { pairs } = computeChangeCoupling(
      [
        entry("c1", "a.ts"),
        entry("c1", "a.ts"),
        entry("c1", "b.ts"),
        entry("c2", "a.ts"),
        entry("c2", "b.ts"),
      ],
      { minCount: 2 },
    );
    expect(pairs[0]!.count).toBe(2);
  });

  it("skips commits that touch more files than largeCommitThreshold", () => {
    const entries: ChurnEntry[] = [];
    // A 5-file sweeping commit — should be skipped at threshold 4.
    for (const f of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]) {
      entries.push(entry("sweep", f));
    }
    // Two normal small commits — produce a pair (a,b) with count=2.
    entries.push(entry("c1", "a.ts"), entry("c1", "b.ts"));
    entries.push(entry("c2", "a.ts"), entry("c2", "b.ts"));

    const { pairs } = computeChangeCoupling(entries, {
      largeCommitThreshold: 4,
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ fileA: "a.ts", fileB: "b.ts", count: 2 });
    expect(pairs[0]!.commits).toEqual(["c1", "c2"]);
  });

  it("reports skippedLargeCommits count for over-threshold commits", () => {
    const entries: ChurnEntry[] = [];
    // Two sweeping 5-file commits — both skipped at threshold 4.
    for (const f of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]) {
      entries.push(entry("sweep1", f));
      entries.push(entry("sweep2", f));
    }
    // A 3-file commit that fits under the threshold.
    entries.push(entry("normal", "x.ts"), entry("normal", "y.ts"), entry("normal", "z.ts"));
    // A single-file commit (won't pair, won't count as skipped either).
    entries.push(entry("solo", "a.ts"));

    const result = computeChangeCoupling(entries, { largeCommitThreshold: 4 });
    expect(result.skippedLargeCommits).toBe(2);
    expect(result.largeCommitThreshold).toBe(4);
  });

  it("uses the default threshold when none is provided", () => {
    const entries: ChurnEntry[] = [];
    for (let i = 0; i < 60; i++) {
      entries.push(entry("big", `file${i}.ts`));
    }
    const result = computeChangeCoupling(entries);
    expect(result.skippedLargeCommits).toBe(1);
    expect(result.largeCommitThreshold).toBe(50);
  });

  it("respects --min-count threshold", () => {
    const entries = [
      entry("c1", "a.ts"),
      entry("c1", "b.ts"),
      entry("c2", "c.ts"),
      entry("c2", "d.ts"),
      entry("c2", "a.ts"),
      entry("c2", "b.ts"),
    ];
    const lowBar = computeChangeCoupling(entries, { minCount: 1 });
    const strict = computeChangeCoupling(entries, { minCount: 2 });
    expect(lowBar.pairs.length).toBeGreaterThan(strict.pairs.length);
    expect(strict.pairs.map((p) => `${p.fileA}|${p.fileB}`)).toEqual([
      "a.ts|b.ts",
    ]);
  });

  it("truncates commits sample at maxCommitsPerPair", () => {
    const entries: ChurnEntry[] = [];
    for (let i = 1; i <= 6; i++) {
      entries.push(entry(`c${i}`, "a.ts"), entry(`c${i}`, "b.ts"));
    }
    const { pairs } = computeChangeCoupling(entries, {
      minCount: 2,
      maxCommitsPerPair: 3,
    });
    expect(pairs[0]!.count).toBe(6); // count is the full tally
    expect(pairs[0]!.commits).toHaveLength(3); // sample is capped
  });

  it("filters by knownFileIds", () => {
    const { pairs } = computeChangeCoupling(
      [
        entry("c1", "a.ts"),
        entry("c1", "b.ts"),
        entry("c1", "untracked.ts"),
        entry("c2", "a.ts"),
        entry("c2", "b.ts"),
      ],
      { knownFileIds: new Set(["a.ts", "b.ts"]) },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ fileA: "a.ts", fileB: "b.ts" });
  });

  it("sorts pairs by count desc, ids ascending on ties", () => {
    const entries = [
      entry("c1", "a.ts"),
      entry("c1", "b.ts"),
      entry("c2", "a.ts"),
      entry("c2", "b.ts"),
      entry("c3", "c.ts"),
      entry("c3", "d.ts"),
      entry("c4", "c.ts"),
      entry("c4", "d.ts"),
      entry("c5", "x.ts"),
      entry("x.ts", "y.ts"),
    ];
    const { pairs } = computeChangeCoupling(entries);
    expect(pairs.slice(0, 2).map((p) => `${p.fileA}|${p.fileB}`)).toEqual([
      "a.ts|b.ts",
      "c.ts|d.ts",
    ]);
  });
});

describe("couplingFor", () => {
  it("returns partners for a given seed sorted by count desc", () => {
    const pairs = [
      { fileA: "a.ts", fileB: "b.ts", count: 5, commits: [] },
      { fileA: "a.ts", fileB: "c.ts", count: 3, commits: [] },
      { fileA: "d.ts", fileB: "a.ts", count: 8, commits: [] },
      { fileA: "x.ts", fileB: "y.ts", count: 10, commits: [] },
    ];
    const result = couplingFor(pairs, "a.ts");
    expect(result.map((r) => r.partner)).toEqual(["d.ts", "b.ts", "c.ts"]);
    expect(result.map((r) => r.count)).toEqual([8, 5, 3]);
  });

  it("returns empty when seed appears in no pair", () => {
    expect(couplingFor([], "nope.ts")).toEqual([]);
  });
});
