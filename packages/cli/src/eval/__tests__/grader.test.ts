import { describe, it, expect } from "vitest";
import {
  gradeRanked,
  gradeRoleSplit,
  gradeSet,
  gradeTask,
  type AnswerFor,
} from "../grader.js";
import type { OracleTask } from "../types.js";

describe("gradeSet", () => {
  it("scores a perfect answer as 1.0 precision/recall/f1", () => {
    const s = gradeSet(["a", "b", "c"], ["c", "b", "a"]);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.f1).toBe(1);
  });

  it("scores an empty answer as zero", () => {
    const s = gradeSet(["a", "b"], []);
    expect(s.precision).toBe(0);
    expect(s.recall).toBe(0);
    expect(s.f1).toBe(0);
  });

  it("computes partial precision and recall", () => {
    // expected {a,b,c,d}, predicted {a,b,x} → 2 TP: P=2/3, R=2/4
    const s = gradeSet(["a", "b", "c", "d"], ["a", "b", "x"]);
    expect(s.truePositives).toBe(2);
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(s.recall).toBe(0.5);
    expect(s.f1).toBeCloseTo((2 * (2 / 3) * 0.5) / (2 / 3 + 0.5));
  });

  it("ignores duplicate predictions (set semantics)", () => {
    const s = gradeSet(["a", "b"], ["a", "a", "a"]);
    expect(s.predicted).toBe(1);
    expect(s.recall).toBe(0.5);
  });
});

describe("gradeRoleSplit", () => {
  it("scores a perfect split as macroF1 1.0 and roleAccuracy 1.0", () => {
    const s = gradeRoleSplit(
      { source: ["p.ts"], test: ["t.test.ts"] },
      { source: ["p.ts"], test: ["t.test.ts"] },
    );
    expect(s.macroF1).toBe(1);
    expect(s.roleAccuracy).toBe(1);
  });

  it("penalizes a mislabeled role via roleAccuracy while recall stays high", () => {
    // both consumers found, but swapped buckets
    const s = gradeRoleSplit(
      { source: ["p.ts"], test: ["t.test.ts"] },
      { source: ["t.test.ts"], test: ["p.ts"] },
    );
    expect(s.roleAccuracy).toBe(0);
    expect(s.macroF1).toBe(0);
  });

  it("gives half roleAccuracy when one of two is misplaced", () => {
    const s = gradeRoleSplit(
      { source: ["a.ts", "b.ts"], test: [] },
      { source: ["a.ts"], test: ["b.ts"] },
    );
    expect(s.roleAccuracy).toBe(0.5);
  });
});

describe("gradeRanked", () => {
  it("scores an identical ranking as spearman 1 and full top-k overlap", () => {
    const s = gradeRanked(["x", "y", "z"], ["x", "y", "z"]);
    expect(s.spearman).toBe(1);
    expect(s.topKOverlap).toBe(1);
  });

  it("scores a reversed ranking as spearman -1", () => {
    const s = gradeRanked(["x", "y", "z"], ["z", "y", "x"]);
    expect(s.spearman).toBe(-1);
  });

  it("returns spearman 0 when fewer than two items overlap", () => {
    const s = gradeRanked(["x", "y"], ["q"]);
    expect(s.spearman).toBe(0);
    expect(s.topKOverlap).toBe(0);
  });
});

describe("gradeTask dispatch", () => {
  const listTask: OracleTask = {
    id: "dependencies::f",
    type: "dependencies",
    stratum: "import-chain-reachable",
    targetId: "f",
    targetKind: "file",
    question: "q",
    groundTruth: { kind: "list", items: ["a", "b"] },
  };
  const splitTask: OracleTask = {
    ...listTask,
    id: "prod-vs-test-consumers::s",
    type: "prod-vs-test-consumers",
    groundTruth: { kind: "role-split", source: ["a"], test: ["b"] },
  };
  const rankedTask: OracleTask = {
    ...listTask,
    id: "blast-radius::f",
    type: "blast-radius",
    groundTruth: { kind: "ranked", items: ["a", "b"] },
  };

  it("routes a list ground truth to gradeSet", () => {
    const r = gradeTask(listTask, ["a", "b"]);
    expect(r.type).toBe("list");
    if (r.type === "list") expect(r.score.f1).toBe(1);
  });

  it("routes a role-split ground truth to gradeRoleSplit", () => {
    const answer: AnswerFor = { source: ["a"], test: ["b"] };
    const r = gradeTask(splitTask, answer);
    expect(r.type).toBe("role-split");
    if (r.type === "role-split") expect(r.score.macroF1).toBe(1);
  });

  it("routes a ranked ground truth to gradeRanked", () => {
    const r = gradeTask(rankedTask, ["a", "b"]);
    expect(r.type).toBe("ranked");
    if (r.type === "ranked") expect(r.score.spearman).toBe(1);
  });
});
