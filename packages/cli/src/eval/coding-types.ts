/**
 * C-83 coding bench (D3) — shared task/suite/gate types.
 *
 * D3 escapes the D2 tautology: the comprehension/retrieval oracles ARE
 * codewatch's own resolved graph, so an arm that reads the graph back was graded
 * against its own projection. The coding bench grades against a signal codewatch
 * does NOT author — the repo's own tests — so codewatch can be *wrong*, and a win
 * is finally meaningful.
 *
 * A `CodingTask` mirrors the SWE-bench instance shape (git-history-as-oracle,
 * fail-to-pass): the agent's world is the parent commit, it is given the failing
 * test patch, and it must edit source until the `failToPass` tests pass without
 * breaking `passToPass`. Everything here is deterministic and committable — the
 * arm RUNNER (which spends LLM tokens) is scratch, per the C-82 guardrail.
 */

import type { Stratum } from "./types.js";

/** How git reports one path in a commit's `--name-status` diff. */
export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** One file touched by a candidate commit, with its churn magnitude. */
export interface FileChange {
  path: string;
  status: ChangeStatus;
  /** Lines added in this file (null when git reports `-` for a binary file). */
  added: number | null;
  /** Lines deleted in this file (null for binary). */
  deleted: number | null;
}

/** A commit surfaced by mining, before any scope/gate filtering. */
export interface CommitInfo {
  sha: string;
  parent: string | null;
  subject: string;
  changes: FileChange[];
}

/** The test / source / other partition of a candidate commit's changed files. */
export interface FilePartition {
  testFiles: string[];
  sourceFiles: string[];
  otherFiles: string[];
}

/** One test's outcome as parsed from `vitest --reporter=json`. */
export interface VitestTest {
  /** Stable identity across runs: `<relFile> :: <fullName>`. */
  id: string;
  file: string;
  name: string;
  status: "pass" | "fail" | "skip";
}

/** Aggregated status of a test across K admission-gate runs. */
export type StableStatus = "pass" | "fail" | "flaky";

/**
 * A history-derived coding task. The agent gets `problemStatement` +
 * `testPatch.diff` (applied to the parent) and must produce a source edit that
 * flips `failToPass` green without regressing `passToPass`.
 */
export interface CodingTask {
  /** Stable id: `<commitShort>::<primaryEditFile>`. */
  id: string;
  corpus: {
    repo: string;
    /** The agent's world — the commit's PARENT (a history-truncated clone). */
    parentCommit: string;
    /** The real fix commit — for provenance only; never handed to an arm. */
    fixCommit: string;
  };
  /** NL synthesized from the failing tests — NEVER the commit/PR message. */
  problemStatement: string;
  testPatch: {
    /** The new/changed test files (relative paths), for stratification/display. */
    files: string[];
    /** Unified diff of the test files, applied to the parent to reveal failures. */
    diff: string;
  };
  /** Tests that FAIL at parent+testPatch, PASS at the fix commit (the oracle). */
  failToPass: string[];
  /** Tests that pass in both — the regression guard. */
  passToPass: string[];
  /** The real commit's source (non-test) diff — tie-break oracle only. */
  goldDiff: string;
  /** Non-test files the real commit changed (stratification + display only). */
  editFiles: string[];
  /** Discoverability of `editFiles` from the testPatch's imports (reuse C-82). */
  stratum: Stratum;
}

/**
 * The admission funnel — every stage's survivor count, so the drop rate is
 * VISIBLE, not silent. A strict gate is expected to reject most mined commits.
 */
export interface AdmissionFunnel {
  /** Commits returned by the `git log` mining window. */
  mined: number;
  /** Rejected by the commit-message reject filter (revert/chore/merge/…). */
  messageRejected: number;
  /** Rejected by the single-purpose scope guard (too many files / too much LOC). */
  scopeRejected: number;
  /** Candidates that reached the fail-to-pass admission gate. */
  gateRun: number;
  /** Rejected at the gate for producing no stable fail-to-pass transition. */
  gateNoTransition: number;
  /** Rejected at the gate because the environment failed (install/apply/run). */
  gateEnvError: number;
  /** Admitted tasks emitted into the suite. */
  admitted: number;
}

export interface CodingSuite {
  source: {
    repo: string;
    /** Ref/branch the mining window walked back from. */
    ref: string;
    /** HEAD commit the window started at. */
    headCommit: string | null;
  };
  params: {
    windowDays: number;
    maxSourceFiles: number;
    maxChangedLoc: number;
    gateRuns: number;
    cap: number;
  };
  funnel: AdmissionFunnel;
  counts: {
    total: number;
    byStratum: Record<Stratum, number>;
  };
  tasks: CodingTask[];
}

/**
 * The grade of one arm attempt (`gradeCoding`). `resolved` — both `failToPass`
 * now pass AND `passToPass` still pass — is the headline; everything else is
 * diagnostic. This is test-pass, computed by the repo's own suite; codewatch
 * never touches it.
 */
export interface CodingResolveResult {
  /** SWE-bench "resolved": failToPass all green AND passToPass all still green. */
  resolved: boolean;
  /** failToPass tests that passed after the agent's edit. */
  failToPassPassed: string[];
  /** failToPass tests still failing. */
  failToPassFailed: string[];
  /** passToPass tests that regressed (broke). */
  passToPassRegressed: string[];
  /** True when the test runner itself errored (env/apply failure), not a fail. */
  runError: boolean;
}
