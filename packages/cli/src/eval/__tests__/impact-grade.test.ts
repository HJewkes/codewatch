import { describe, it, expect } from "vitest";
import { gradeImpact } from "../impact-grade.js";

const GOLD = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];

describe("gradeImpact", () => {
  it("scores recall, precision and F1 of the answer against the gold set", () => {
    const score = gradeImpact(GOLD, ["src/a.ts", "src/b.ts", "src/x.ts", "src/y.ts"]);

    expect(score).toMatchObject({
      recall: 0.5,
      precision: 0.5,
      f1: 0.5,
      truePositives: 2,
      budget: 10,
      overBudget: 0,
    });
  });

  it("grades only the first files up to the budget", () => {
    const answer = ["src/x.ts", "src/y.ts", "src/a.ts", "src/b.ts"];

    const score = gradeImpact(GOLD, answer, 2);

    expect(score).toMatchObject({ recall: 0, predicted: 2, overBudget: 2 });
  });

  it("counts a repeated or ./-prefixed path once", () => {
    const score = gradeImpact(GOLD, ["./src/a.ts", "src/a.ts", " src/b.ts "]);

    expect(score).toMatchObject({ recall: 0.5, precision: 1, predicted: 2 });
  });

  it("scores an empty answer as zero", () => {
    expect(gradeImpact(GOLD, [])).toMatchObject({ recall: 0, precision: 0, f1: 0 });
  });
});
