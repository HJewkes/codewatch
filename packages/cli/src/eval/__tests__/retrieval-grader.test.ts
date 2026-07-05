import { describe, it, expect } from "vitest";
import { gradeRetrieval } from "../retrieval-grader.js";
import type { RetrievalTask } from "../retrieval-types.js";

const task: RetrievalTask = {
  id: "retrieval::q.ts",
  queryFileId: "q.ts",
  question: "…",
  relevant: [
    { fileId: "a.ts", stratum: "semantic-findable" },
    { fileId: "b.ts", stratum: "structurally-hidden" },
    { fileId: "c.ts", stratum: "structurally-hidden" },
  ],
};

describe("gradeRetrieval", () => {
  it("scores a perfect top-k ranking", () => {
    const s = gradeRetrieval(task, ["a.ts", "b.ts", "c.ts"], 3);
    expect(s.recallAtK).toBe(1);
    expect(s.precisionAtK).toBe(1);
    expect(s.reciprocalRank).toBe(1);
    expect(s.hits).toBe(3);
  });

  it("scores an empty ranking as zero", () => {
    const s = gradeRetrieval(task, [], 3);
    expect(s.recallAtK).toBe(0);
    expect(s.precisionAtK).toBe(0);
    expect(s.reciprocalRank).toBe(0);
  });

  it("respects the k cutoff — a relevant hit past k does not count", () => {
    // b.ts and c.ts pushed below k=2 by irrelevant fillers
    const s = gradeRetrieval(task, ["a.ts", "x.ts", "b.ts", "c.ts"], 2);
    expect(s.hits).toBe(1);
    expect(s.recallAtK).toBeCloseTo(1 / 3);
    expect(s.precisionAtK).toBe(0.5);
  });

  it("computes reciprocal rank from the first relevant hit", () => {
    const s = gradeRetrieval(task, ["x.ts", "y.ts", "a.ts"], 5);
    expect(s.reciprocalRank).toBeCloseTo(1 / 3);
  });

  it("reports recall per stratum so hidden-neighbour lift is isolated", () => {
    // finds the semantic neighbour but misses both structurally-hidden ones
    const s = gradeRetrieval(task, ["a.ts", "x.ts"], 5);
    expect(s.recallByStratum["semantic-findable"]).toBe(1);
    expect(s.recallByStratum["structurally-hidden"]).toBe(0);
    expect(s.recallByStratum["import-chain-reachable"]).toBeUndefined();
  });

  it("de-duplicates a ranking before scoring", () => {
    const s = gradeRetrieval(task, ["a.ts", "a.ts", "a.ts"], 3);
    expect(s.hits).toBe(1);
    // top-k after de-dup is just [a.ts]; precision is 1/1 over the single slot
    expect(s.precisionAtK).toBe(1);
  });
});
