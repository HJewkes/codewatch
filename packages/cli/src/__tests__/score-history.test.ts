import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  appendScoreRun,
  previousComparable,
  readScoreHistory,
  scoreDelta,
  type ScoreRun,
} from "../commands/score-history.js";

function run(overrides: Partial<ScoreRun>): ScoreRun {
  return {
    formulaVersion: 1,
    score: 100,
    components: [
      { label: "scary hotspots", penalty: 0, detail: "" },
      { label: "value cycles", penalty: 0, detail: "" },
    ],
    commit: "0000000000000000000000000000000000000000",
    snapshotId: 1,
    at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("score history", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "codewatch-score-history-"));
    file = path.join(dir, ".codewatch", "score-history.jsonl");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a missing file as an empty history", () => {
    expect(readScoreHistory(file)).toEqual({ runs: [], skipped: 0 });
  });

  it("round-trips appended runs in order", () => {
    const first = run({ score: 90 });
    const second = run({ score: 80, snapshotId: 2 });

    appendScoreRun(file, first);
    appendScoreRun(file, second);

    expect(readScoreHistory(file)).toEqual({ runs: [first, second], skipped: 0 });
  });

  it("skips and counts a malformed line instead of throwing", () => {
    appendScoreRun(file, run({ score: 90 }));
    fs.appendFileSync(file, "{not json\n" + JSON.stringify({ score: "high" }) + "\n");
    appendScoreRun(file, run({ score: 70 }));

    const history = readScoreHistory(file);

    expect(history.runs.map((r) => r.score)).toEqual([90, 70]);
    expect(history.skipped).toBe(2);
  });
});

describe("previousComparable", () => {
  it("skips a newer run of another formula version and returns the older matching one", () => {
    const older = run({ score: 90 });
    const newerOtherVersion = run({ score: 50, formulaVersion: 0 });

    expect(previousComparable([older, newerOtherVersion], 1)).toBe(older);
  });

  it("returns the most recent matching run", () => {
    const first = run({ score: 90 });
    const second = run({ score: 80 });

    expect(previousComparable([first, second], 1)).toBe(second);
  });

  it("returns undefined when no run shares the version", () => {
    expect(previousComparable([run({ formulaVersion: 0 })], 1)).toBeUndefined();
  });
});

describe("scoreDelta", () => {
  it("subtracts the previous run from the current one, overall and per component", () => {
    const previous = run({ score: 100 });
    const current = run({
      score: 88,
      components: [
        { label: "scary hotspots", penalty: 10, detail: "" },
        { label: "value cycles", penalty: 2, detail: "" },
      ],
    });

    expect(scoreDelta(current, previous)).toEqual({
      score: -12,
      components: { "scary hotspots": 10, "value cycles": 2 },
    });
  });
});
