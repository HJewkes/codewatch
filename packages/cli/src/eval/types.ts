/**
 * C-82 comprehension oracle — shared task/suite/score types.
 *
 * The resolved graph *is* the oracle: every task's `groundTruth` is derived
 * deterministically from `.codewatch/graph.db` the same way `graph context`
 * computes it, so an arm's answer can be graded with no human labeling.
 */

/**
 * Dependency-discoverability stratum (borrowed from CodeCompass). Buckets a task
 * by the *cheapest* way an agent WITHOUT the resolved graph could discover the
 * dependency — so codewatch's marginal value shows where it should: on the
 * `structurally-hidden` bucket. See `classifyReferenceEdge` for the heuristic.
 */
export type Stratum =
  | "semantic-findable"
  | "import-chain-reachable"
  | "structurally-hidden";

export const ALL_STRATA: readonly Stratum[] = [
  "semantic-findable",
  "import-chain-reachable",
  "structurally-hidden",
];

export type TaskType =
  | "dependencies"
  | "reverse-deps"
  | "prod-vs-test-consumers"
  | "blast-radius";

export const ALL_TASK_TYPES: readonly TaskType[] = [
  "dependencies",
  "reverse-deps",
  "prod-vs-test-consumers",
  "blast-radius",
];

/** An unordered set answer (dependencies / reverse-deps). */
export interface ListGroundTruth {
  kind: "list";
  items: string[];
}

/** A production-vs-test role split (consumers of a symbol). */
export interface RoleSplitGroundTruth {
  kind: "role-split";
  source: string[];
  test: string[];
}

/** A best→worst ranked answer (blast radius). */
export interface RankedGroundTruth {
  kind: "ranked";
  items: string[];
}

export type GroundTruth =
  | ListGroundTruth
  | RoleSplitGroundTruth
  | RankedGroundTruth;

export interface OracleTask {
  /** Stable id: `<type>::<targetId>`. Deterministic, human-readable. */
  id: string;
  type: TaskType;
  stratum: Stratum;
  /** File id or `<fileId>#<name>` symbol id the question is about. */
  targetId: string;
  targetKind: "file" | "symbol";
  /** Natural-language prompt handed to an arm (A0–A3). */
  question: string;
  groundTruth: GroundTruth;
}

export interface OracleSuite {
  /** Provenance of the graph the suite was generated from (all deterministic). */
  source: {
    snapshotId: number;
    ref: string;
    commitHash: string | null;
    indexVersion: string;
  };
  /** Generation parameters, echoed so a reader knows what was capped. */
  params: { perTypeCap: number };
  counts: {
    total: number;
    byType: Record<TaskType, number>;
    byStratum: Record<Stratum, number>;
  };
  tasks: OracleTask[];
}

/** Set-overlap score for a list answer. */
export interface SetScore {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  expected: number;
  predicted: number;
}

/** Role-split score: per-side set overlap plus role placement accuracy. */
export interface RoleSplitScore {
  source: SetScore;
  test: SetScore;
  /** Macro-average of the two sides' F1. */
  macroF1: number;
  /**
   * Of the items correctly identified as consumers (either side), the fraction
   * placed in the correct role bucket. Isolates the role call from recall.
   */
  roleAccuracy: number;
}

/** Ranked score: rank correlation plus top-k set overlap. */
export interface RankedScore {
  /** Spearman ρ over items present in both, by ground-truth rank. NaN→0. */
  spearman: number;
  /** Jaccard overlap of the top-k of each ranking. */
  topKOverlap: number;
  k: number;
}

export type TaskScore =
  | { type: "list"; score: SetScore }
  | { type: "role-split"; score: RoleSplitScore }
  | { type: "ranked"; score: RankedScore };
