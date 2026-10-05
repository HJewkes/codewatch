import type { SetScore } from "./types.js";

/**
 * Impact track (C-86 T7): given a seed change already applied to the parent
 * tree, name the other existing files that must change. The oracle is the
 * historical co-edit set: the fix commit's dark files with a `logic` change.
 */

/** Answers past this many files are not graded (plan section 4: at most 10 files). */
export const IMPACT_ANSWER_BUDGET = 10;

/** The C-86 patch-task types. Assigned by rule in `coding-task-type.ts`; absent when undecided. */
export type CodingTaskType = "T1" | "T2" | "T3" | "T4" | "T5" | "T6";

export interface ImpactTask {
  id: string;
  fixCommit: string;
  parentCommit: string;
  /** The non-dark edit files, whose diff is the seed. */
  seedFiles: string[];
  /** Unified diff of the seed files, from the parent to the fix commit. */
  seedDiff: string;
  /** Dark edit files whose change is `logic`. Never shown to the arm. */
  gold: string[];
  type?: CodingTaskType;
}

export type ImpactRejection = "no-gold" | "no-seed" | "gold-leak";

export type ImpactBuild =
  | { ok: true; task: ImpactTask }
  | { ok: false; reason: ImpactRejection; leaks?: string[] };

export interface ImpactScore extends SetScore {
  budget: number;
  /** Distinct answer files past the budget, which score nothing. */
  overBudget: number;
}
