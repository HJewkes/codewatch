import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  classifyEditFiles,
  diffForPaths,
  listWindowCommits,
  loadCommitChanges,
  partitionChangedFiles,
  passesScope,
  resolveHead,
  shouldRejectByMessage,
} from "./coding-mine.js";
import { runAdmissionGate, type GateResult, type VitestRunOptions } from "./coding-grade.js";
import type {
  AdmissionFunnel,
  CodingSuite,
  CodingTask,
  CommitInfo,
} from "./coding-types.js";
import type { Stratum } from "./types.js";
import { ALL_STRATA } from "./types.js";

/**
 * C-83 Stage A generator. `generateCodingSuite` mines a repo's recent history for
 * single-purpose, test-carrying commits and admits only those with a stable
 * fail-to-pass transition (the expensive gate). No LLM — this is the deterministic,
 * committable spine; the arm runner that spends tokens is scratch (per C-82's
 * guardrail). Mining/gate management shells git + pnpm + vitest and is verified
 * against a real clone; the admission orchestration is unit-tested via an injected
 * gate.
 */

const DEFAULTS = {
  ref: "HEAD",
  windowDays: 270,
  maxSourceFiles: 3,
  maxChangedLoc: 80,
  gateRuns: 3,
  cap: 25,
  lockfilePath: "pnpm-lock.yaml",
};

export interface GenerateCodingOptions {
  ref?: string;
  windowDays?: number;
  maxSourceFiles?: number;
  maxChangedLoc?: number;
  gateRuns?: number;
  cap?: number;
  /** Root-relative lockfile whose hash batches installs (default pnpm-lock.yaml). */
  lockfilePath?: string;
  /** Working checkout the gate mutates; defaults to `repo` itself. */
  workdir?: string;
  vitest?: VitestRunOptions;
}

/** A mined, scope-passing candidate — everything the gate + stratifier need. */
export interface Candidate {
  commit: CommitInfo;
  parentCommit: string;
  testFiles: string[];
  editFiles: string[];
  testPatchDiff: string;
  goldDiff: string;
  stratum: Stratum;
  /** Hash of the parent's lockfile — consecutive equal hashes share one install. */
  lockfileHash: string;
}

function git(repo: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repo,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Read a blob at a commit, or "" when the path does not exist there. */
function showBlob(repo: string, commit: string, path: string): string {
  try {
    return git(repo, ["show", `${commit}:${path}`]);
  } catch {
    return "";
  }
}

function lockfileHashAt(repo: string, commit: string, lockfilePath: string): string {
  const blob = showBlob(repo, commit, lockfilePath);
  return createHash("sha1").update(blob).digest("hex").slice(0, 12);
}

function treeFileIds(repo: string, commit: string): Set<string> {
  try {
    const out = git(repo, ["ls-tree", "-r", "--name-only", commit]);
    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Synthesize a deterministic problem statement from the FAILING TESTS — never the
 * commit/PR message (text-leakage fix). Stage A emits a template; a richer
 * LLM-authored statement is a later enhancement. The agent also receives the
 * applied test patch, so this is the honest framing of the task.
 */
export function buildProblemStatement(testFiles: readonly string[]): string {
  const list = testFiles.map((f) => `  - ${f}`).join("\n");
  return [
    "One or more tests in this repository are currently failing.",
    "The failing test file(s) have been added to the working tree:",
    list,
    "",
    "Edit the source (not the tests) so that the failing tests pass, without",
    "breaking any tests that currently pass. Do not modify the test files.",
  ].join("\n");
}

/** Mine + scope-filter candidates (shells git). Populates `funnel` in place. */
export function mineCandidates(
  repo: string,
  opts: Required<Omit<GenerateCodingOptions, "workdir" | "vitest">>,
  funnel: AdmissionFunnel,
): Candidate[] {
  const commits = listWindowCommits(repo, {
    ref: opts.ref,
    windowDays: opts.windowDays,
    maxSourceFiles: opts.maxSourceFiles,
    maxChangedLoc: opts.maxChangedLoc,
  });
  funnel.mined = commits.length;
  const candidates: Candidate[] = [];
  for (const bare of commits) {
    if (shouldRejectByMessage(bare.subject)) {
      funnel.messageRejected += 1;
      continue;
    }
    if (!bare.parent) {
      funnel.scopeRejected += 1;
      continue;
    }
    const commit = loadCommitChanges(repo, bare);
    const partition = partitionChangedFiles(commit.changes);
    if (!passesScope(partition, commit.changes, opts)) {
      funnel.scopeRejected += 1;
      continue;
    }
    candidates.push(buildCandidate(repo, commit, partition, opts.lockfilePath));
  }
  return candidates;
}

function buildCandidate(
  repo: string,
  commit: CommitInfo,
  partition: ReturnType<typeof partitionChangedFiles>,
  lockfilePath: string,
): Candidate {
  const parentCommit = commit.parent!;
  const testFiles = partition.testFiles;
  const editFiles = partition.sourceFiles;
  const testSources = new Map(
    testFiles.map((f) => [f, showBlob(repo, commit.sha, f)]),
  );
  const stratum = classifyEditFiles(
    editFiles,
    testFiles,
    testSources,
    treeFileIds(repo, parentCommit),
  );
  return {
    commit,
    parentCommit,
    testFiles,
    editFiles,
    testPatchDiff: diffForPaths(repo, commit.sha, testFiles),
    goldDiff: diffForPaths(repo, commit.sha, editFiles),
    stratum,
    lockfileHash: lockfileHashAt(repo, parentCommit, lockfilePath),
  };
}

/** A gate function — injectable so the orchestration is unit-testable. */
export type GateFn = (candidate: Candidate) => GateResult;

/**
 * Run the admission gate over candidates (grouped by lockfile hash so the caller
 * installs once per group), emitting admitted `CodingTask`s and tallying the
 * funnel. Stops once `cap` tasks are admitted. Pure orchestration over `gate`.
 */
export function admitCandidates(
  candidates: readonly Candidate[],
  cap: number,
  gate: GateFn,
  funnel: AdmissionFunnel,
): CodingTask[] {
  const tasks: CodingTask[] = [];
  for (const c of orderByLockfile(candidates)) {
    if (tasks.length >= cap) break;
    funnel.gateRun += 1;
    const result = gate(c);
    if (result.outcome === "env-error") {
      funnel.gateEnvError += 1;
      continue;
    }
    if (result.outcome === "no-transition") {
      funnel.gateNoTransition += 1;
      continue;
    }
    funnel.admitted += 1;
    tasks.push(toTask(c, result.failToPass, result.passToPass));
  }
  return tasks;
}

/** Stable sort grouping candidates by lockfile hash (batches installs). */
function orderByLockfile(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates]
    .map((c, i) => ({ c, i }))
    .sort((a, b) =>
      a.c.lockfileHash === b.c.lockfileHash
        ? a.i - b.i
        : a.c.lockfileHash < b.c.lockfileHash
          ? -1
          : 1,
    )
    .map(({ c }) => c);
}

function toTask(c: Candidate, failToPass: string[], passToPass: string[]): CodingTask {
  const primary = c.editFiles[0] ?? c.commit.sha;
  return {
    id: `${c.commit.sha.slice(0, 9)}::${primary}`,
    corpus: {
      repo: "",
      parentCommit: c.parentCommit,
      fixCommit: c.commit.sha,
    },
    problemStatement: buildProblemStatement(c.testFiles),
    testPatch: { files: c.testFiles, diff: c.testPatchDiff },
    failToPass,
    passToPass,
    goldDiff: c.goldDiff,
    editFiles: c.editFiles,
    stratum: c.stratum,
  };
}

function emptyFunnel(): AdmissionFunnel {
  return {
    mined: 0,
    messageRejected: 0,
    scopeRejected: 0,
    gateRun: 0,
    gateNoTransition: 0,
    gateEnvError: 0,
    admitted: 0,
  };
}

function countByStratum(tasks: readonly CodingTask[]): Record<Stratum, number> {
  const out = Object.fromEntries(ALL_STRATA.map((s) => [s, 0])) as Record<Stratum, number>;
  for (const t of tasks) out[t.stratum] += 1;
  return out;
}

/**
 * End-to-end Stage A entry point: mine → gate → suite. Installs dependencies once
 * per lockfile group in `workdir` (default: the repo itself) before gating that
 * group's candidates. Deterministic given the same history and environment.
 */
export function generateCodingSuite(
  repo: string,
  options: GenerateCodingOptions = {},
): CodingSuite {
  const opts = {
    ref: options.ref ?? DEFAULTS.ref,
    windowDays: options.windowDays ?? DEFAULTS.windowDays,
    maxSourceFiles: options.maxSourceFiles ?? DEFAULTS.maxSourceFiles,
    maxChangedLoc: options.maxChangedLoc ?? DEFAULTS.maxChangedLoc,
    gateRuns: options.gateRuns ?? DEFAULTS.gateRuns,
    cap: options.cap ?? DEFAULTS.cap,
    lockfilePath: options.lockfilePath ?? DEFAULTS.lockfilePath,
  };
  const workdir = options.workdir ?? repo;
  const headCommit = resolveHead(repo, opts.ref);
  const funnel = emptyFunnel();
  const candidates = mineCandidates(repo, opts, funnel);

  let installedHash: string | null = null;
  const gate: GateFn = (c) => {
    installOnce(workdir, c, () => installedHash, (h) => (installedHash = h));
    return runAdmissionGate(workdir, {
      runs: opts.gateRuns,
      testFiles: c.testFiles,
      testPatchDiff: c.testPatchDiff,
      parentCommit: c.parentCommit,
      fixCommit: c.commit.sha,
      vitest: options.vitest,
    });
  };

  const tasks = admitCandidates(candidates, opts.cap, gate, funnel).map((t) => ({
    ...t,
    corpus: { ...t.corpus, repo },
  }));

  return {
    source: { repo, ref: opts.ref, headCommit },
    params: {
      windowDays: opts.windowDays,
      maxSourceFiles: opts.maxSourceFiles,
      maxChangedLoc: opts.maxChangedLoc,
      gateRuns: opts.gateRuns,
      cap: opts.cap,
    },
    funnel,
    counts: { total: tasks.length, byStratum: countByStratum(tasks) },
    tasks,
  };
}

/** Check out the candidate's parent and `pnpm install` when the lockfile changed. */
function installOnce(
  workdir: string,
  c: Candidate,
  getHash: () => string | null,
  setHash: (h: string) => void,
): void {
  if (getHash() === c.lockfileHash) return;
  execFileSync("git", ["checkout", "-f", c.parentCommit], {
    cwd: workdir,
    stdio: "ignore",
  });
  execFileSync("git", ["clean", "-fdq"], { cwd: workdir, stdio: "ignore" });
  execFileSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: workdir,
    stdio: "ignore",
    timeout: 600_000,
  });
  setHash(c.lockfileHash);
}
