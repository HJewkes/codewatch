import { gradeSet } from "./grader.js";
import { IMPACT_ANSWER_BUDGET, type ImpactScore } from "./impact-types.js";

/**
 * Score an impact answer against the gold set at a fixed answer budget: only
 * the first `budget` distinct files count, so listing the whole repo cannot buy
 * recall. Recall is the headline; precision and F1 are reported beside it.
 */
export function gradeImpact(
  gold: readonly string[],
  answer: readonly string[],
  budget = IMPACT_ANSWER_BUDGET,
): ImpactScore {
  const distinct = [...new Set(answer.map(normalizePath))];
  const graded = distinct.slice(0, budget);
  return {
    ...gradeSet(gold, graded),
    budget,
    overBudget: distinct.length - graded.length,
  };
}

function normalizePath(path: string): string {
  return path.trim().replace(/^(\.?\/)+/, "");
}
