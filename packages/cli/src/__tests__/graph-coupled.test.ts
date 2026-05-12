import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  formatGraphCoupledJson,
  formatGraphCoupledText,
  type GraphCoupledResult,
  type GraphCoupledTopRow,
  type GraphCoupledSeedRow,
} from "../commands/graph-coupled.js";

function topRow(
  rank: number,
  fileA: string,
  fileB: string,
  count: number,
): GraphCoupledTopRow {
  return { rank, fileA, fileB, count, commits: [`c${rank}`] };
}

function seedRow(
  rank: number,
  partner: string,
  count: number,
): GraphCoupledSeedRow {
  return { rank, partner, count, commits: [`c${rank}`] };
}

const SNAPSHOT_FIXTURE = {
  id: 1,
  ref: "main",
  commitHash: null,
  takenAt: new Date(0).toISOString(),
  indexVersion: "0.1.0",
  attrs: {},
};

describe("formatGraphCoupledText", () => {
  it("renders top-pairs table when no seed", () => {
    const result: GraphCoupledResult = {
      snapshot: SNAPSHOT_FIXTURE,
      seed: null,
      windowDays: 30,
      totalPairs: 2,
      rows: [
        topRow(1, "a.ts", "b.ts", 5),
        topRow(2, "c.ts", "d.ts", 3),
      ],
      skippedLargeCommits: 0,
      largeCommitThreshold: 50,
    };
    const text = formatGraphCoupledText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("Top co-edited pairs");
    expect(text).toContain("last 30d");
    expect(text).toContain("a.ts");
    expect(text).toContain("b.ts");
    expect(text).toContain("c.ts");
    expect(text).toContain("d.ts");
  });

  it("renders seed-partners table when seed given", () => {
    const result: GraphCoupledResult = {
      snapshot: SNAPSHOT_FIXTURE,
      seed: "foo.ts",
      windowDays: 30,
      totalPairs: 3,
      rows: [seedRow(1, "bar.ts", 4), seedRow(2, "baz.ts", 2)],
      skippedLargeCommits: 0,
      largeCommitThreshold: 50,
    };
    const text = formatGraphCoupledText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("Co-edited with foo.ts");
    expect(text).toContain("partner");
    expect(text).toContain("bar.ts");
    expect(text).toContain("baz.ts");
  });

  it("renders empty state when no rows", () => {
    const result: GraphCoupledResult = {
      snapshot: null,
      seed: null,
      windowDays: 30,
      totalPairs: 0,
      rows: [],
      skippedLargeCommits: 0,
      largeCommitThreshold: 50,
    };
    const text = formatGraphCoupledText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("No co-edits in window.");
  });
});

describe("formatGraphCoupledJson", () => {
  it("emits structured JSON with rows and seed", () => {
    const result: GraphCoupledResult = {
      snapshot: SNAPSHOT_FIXTURE,
      seed: "foo.ts",
      windowDays: 14,
      totalPairs: 1,
      rows: [seedRow(1, "bar.ts", 3)],
      skippedLargeCommits: 0,
      largeCommitThreshold: 50,
    };
    const parsed = JSON.parse(formatGraphCoupledJson(result));
    expect(parsed.seed).toBe("foo.ts");
    expect(parsed.windowDays).toBe(14);
    expect(parsed.rows[0].partner).toBe("bar.ts");
    expect(parsed.rows[0].count).toBe(3);
  });
});

describe("runGraphCoupledCommand", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("throws when run outside a git repo", async () => {
    const { openDatabase } = await import("@code-style/graph");
    const { runGraphCoupledCommand } = await import("../commands/graph-coupled.js");
    dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-coupled-"));
    const dbPath = path.join(dir, "graph.db");
    const db = openDatabase(dbPath);
    db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
    db.close();

    expect(() =>
      runGraphCoupledCommand({ db: dbPath, repoRoot: dir! }),
    ).toThrow(/git/i);
  });
});
