import type {
  GroundTruth,
  OracleTask,
  RankedScore,
  RoleSplitScore,
  SetScore,
  TaskScore,
} from "./types.js";

/**
 * C-82 grader — pure scoring of a candidate answer against graph-derived ground
 * truth. Dispatch on the ground-truth shape so an arm runner (A0–A3) can score
 * any task uniformly. No I/O, no graph access: unit-testable in isolation.
 */

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Precision / recall / F1 of a predicted set against an expected set. */
export function gradeSet(
  expected: readonly string[],
  predicted: readonly string[],
): SetScore {
  const exp = new Set(expected);
  const pred = new Set(predicted);
  let truePositives = 0;
  for (const p of pred) if (exp.has(p)) truePositives++;
  const precision = ratio(truePositives, pred.size);
  const recall = ratio(truePositives, exp.size);
  return {
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    truePositives,
    expected: exp.size,
    predicted: pred.size,
  };
}

/** Score a production-vs-test role split. */
export function gradeRoleSplit(
  expected: { source: readonly string[]; test: readonly string[] },
  predicted: { source: readonly string[]; test: readonly string[] },
): RoleSplitScore {
  const source = gradeSet(expected.source, predicted.source);
  const test = gradeSet(expected.test, predicted.test);
  return {
    source,
    test,
    macroF1: (source.f1 + test.f1) / 2,
    roleAccuracy: computeRoleAccuracy(expected, predicted),
  };
}

/** Of items correctly named as consumers, the fraction placed in the right bucket. */
function computeRoleAccuracy(
  expected: { source: readonly string[]; test: readonly string[] },
  predicted: { source: readonly string[]; test: readonly string[] },
): number {
  const role = new Map<string, "source" | "test">();
  for (const s of expected.source) role.set(s, "source");
  for (const t of expected.test) role.set(t, "test");
  let correct = 0;
  let total = 0;
  for (const [items, bucket] of [
    [predicted.source, "source"],
    [predicted.test, "test"],
  ] as const) {
    for (const it of items) {
      const truth = role.get(it);
      if (truth === undefined) continue;
      total++;
      if (truth === bucket) correct++;
    }
  }
  return ratio(correct, total);
}

/** 0-based ground-truth rank of each item (best = 0). */
function rankIndex(items: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  items.forEach((it, i) => {
    if (!out.has(it)) out.set(it, i);
  });
  return out;
}

/**
 * Rank agreement for a ranked answer: Spearman ρ over the items present in both
 * rankings (by their positions), plus the Jaccard overlap of the two top-k sets.
 * ρ is 0 when fewer than two items overlap (undefined correlation).
 */
export function gradeRanked(
  expected: readonly string[],
  predicted: readonly string[],
  k = Math.min(5, expected.length),
): RankedScore {
  const expRank = rankIndex(expected);
  const predRank = rankIndex(predicted);
  const shared = [...expRank.keys()].filter((it) => predRank.has(it));
  return {
    spearman: spearman(shared, expRank, predRank),
    topKOverlap: jaccardTopK(expected, predicted, k),
    k,
  };
}

function spearman(
  shared: readonly string[],
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  const n = shared.length;
  if (n < 2) return 0;
  const ar = denseRanks(shared, a);
  const br = denseRanks(shared, b);
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += (ar[i]! - br[i]!) ** 2;
  return 1 - (6 * sumSq) / (n * (n * n - 1));
}

/** Positions within the shared set, re-ranked 0..n-1 by the source ordering. */
function denseRanks(
  shared: readonly string[],
  source: ReadonlyMap<string, number>,
): number[] {
  const ordered = [...shared].sort(
    (x, y) => (source.get(x) ?? 0) - (source.get(y) ?? 0),
  );
  const rank = new Map<string, number>();
  ordered.forEach((it, i) => rank.set(it, i));
  return shared.map((it) => rank.get(it)!);
}

function jaccardTopK(
  expected: readonly string[],
  predicted: readonly string[],
  k: number,
): number {
  if (k <= 0) return 0;
  const exp = new Set(expected.slice(0, k));
  const pred = new Set(predicted.slice(0, k));
  let inter = 0;
  for (const p of pred) if (exp.has(p)) inter++;
  const union = exp.size + pred.size - inter;
  return ratio(inter, union);
}

/** Grade any answer against its task's ground truth, dispatched on GT shape. */
export function gradeTask(task: OracleTask, answer: AnswerFor): TaskScore {
  return gradeAnswer(task.groundTruth, answer);
}

/** A candidate answer, matching the ground-truth shape of its task. */
export type AnswerFor =
  | string[]
  | { source: string[]; test: string[] };

function gradeAnswer(gt: GroundTruth, answer: AnswerFor): TaskScore {
  if (gt.kind === "list") {
    return { type: "list", score: gradeSet(gt.items, asList(answer)) };
  }
  if (gt.kind === "ranked") {
    return { type: "ranked", score: gradeRanked(gt.items, asList(answer)) };
  }
  const split = asSplit(answer);
  return { type: "role-split", score: gradeRoleSplit(gt, split) };
}

function asList(answer: AnswerFor): string[] {
  return Array.isArray(answer) ? answer : [...answer.source, ...answer.test];
}

function asSplit(answer: AnswerFor): { source: string[]; test: string[] } {
  return Array.isArray(answer) ? { source: answer, test: [] } : answer;
}
