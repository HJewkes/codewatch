import { describe, expect, it } from "vitest";
import { SCORE_FORMULA_VERSION, computeScore, type ScoreInputs } from "../commands/score-formula.js";

const CLEAN: ScoreInputs = {
  scary: 0,
  violations: 0,
  maxComplexity: 0,
  hiddenCoupling: 0,
  erosion: 0,
  cyclicMassValue: 0,
};

const SATURATED: ScoreInputs = {
  scary: 50,
  violations: 50,
  maxComplexity: 500,
  hiddenCoupling: 50,
  erosion: 1,
  cyclicMassValue: 1,
};

describe("computeScore", () => {
  it("scores a clean tree 100 with six zero components under formula v1", () => {
    const result = computeScore(CLEAN);

    expect(result.score).toBe(100);
    expect(result.formulaVersion).toBe(SCORE_FORMULA_VERSION);
    expect(SCORE_FORMULA_VERSION).toBe(1);
    expect(result.components.map((c) => [c.label, c.penalty])).toEqual([
      ["scary hotspots", 0],
      ["fitness violations", 0],
      ["complexity over budget", 0],
      ["hidden coupling", 0],
      ["erosion", 0],
      ["value cycles", 0],
    ]);
  });

  it("holds every component at its cap and the score at 0 when every input saturates", () => {
    const result = computeScore(SATURATED);

    expect(result.components.map((c) => c.penalty)).toEqual([30, 20, 15, 10, 15, 10]);
    expect(result.score).toBe(0);
  });

  it("weighs erosion 0.12 as 6.0 points and value cycles 0.05 as 2.0 points", () => {
    const result = computeScore({ ...CLEAN, erosion: 0.12, cyclicMassValue: 0.05 });

    expect(result.components.find((c) => c.label === "erosion")!.penalty).toBe(6);
    expect(result.components.find((c) => c.label === "value cycles")!.penalty).toBe(2);
    expect(result.score).toBe(92);
  });

  it("counts every violation at the carried weight, so run order cannot change the score", () => {
    const result = computeScore({ ...CLEAN, violations: 2 });

    expect(result.components.find((c) => c.label === "fitness violations")!.penalty).toBe(6);
    expect(result.score).toBe(94);
  });

  it("never scores below 0", () => {
    expect(computeScore({ ...SATURATED, scary: 1000 }).score).toBe(0);
  });
});
