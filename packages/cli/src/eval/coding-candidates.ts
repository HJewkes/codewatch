import { createHash } from "node:crypto";
import type { DocumentFrequency } from "./coding-hardness.js";
import {
  diffForPaths,
  listWindowCommits,
  loadCommitChanges,
  partitionChangedFiles,
  passesScope,
  shouldRejectByMessage,
} from "./coding-mine.js";
import { lockfilesAt, readBlobs, screenCommit, sourceDocumentFrequency } from "./coding-git.js";
import {
  hardnessFeatures,
  screenVerdict,
  stratumOf,
  type HardnessFeatures,
  type ScreenVerdict,
} from "./coding-screen.js";
import type {
  AdmissionFunnel,
  CommitInfo,
  FilePartition,
  MiningParams,
} from "./coding-types.js";
import type { Stratum } from "./types.js";

/**
 * Mining for the coding suite: the message filter, the loosened scope guard and
 * the hardness screen. Reads git only — no checkout, install or test run.
 */

export interface MiningOptions {
  ref: string;
  windowDays: number;
  /** Most source files a candidate may change. */
  maxSourceFiles: number;
  /** Most changed lines a candidate may carry. */
  maxChangedLoc: number;
  /** Fewest non-trivial dark edit files a candidate needs (0 keeps every candidate). */
  minDark: number;
}

export const MINING_DEFAULTS: MiningOptions = {
  ref: "HEAD",
  windowDays: 270,
  maxSourceFiles: 10,
  maxChangedLoc: 500,
  minDark: 0,
};

export function resolveMiningOptions(o: Partial<MiningOptions>): MiningOptions {
  const d = MINING_DEFAULTS;
  return {
    ref: o.ref ?? d.ref,
    windowDays: o.windowDays ?? d.windowDays,
    maxSourceFiles: o.maxSourceFiles ?? d.maxSourceFiles,
    maxChangedLoc: o.maxChangedLoc ?? d.maxChangedLoc,
    minDark: o.minDark ?? d.minDark,
  };
}

/** The mining options a suite or screen records as its params. */
export function miningParams(o: MiningOptions): MiningParams {
  const { windowDays, maxSourceFiles, maxChangedLoc, minDark } = o;
  return { windowDays, maxSourceFiles, maxChangedLoc, minDark };
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
  hardness: HardnessFeatures;
  /** Known root lockfiles at the parent; they pick the package manager. */
  lockfiles: string[];
  /** Hash of the parent's lockfiles — consecutive equal hashes share one install. */
  lockfileHash: string;
}

type RejectStage = "messageRejected" | "scopeRejected" | "darkRejected" | "trivialRejected";

const VERDICT_STAGE: Record<Exclude<ScreenVerdict, "pass">, RejectStage> = {
  "dark-rejected": "darkRejected",
  "trivial-rejected": "trivialRejected",
};

export function emptyFunnel(): AdmissionFunnel {
  return {
    mined: 0,
    messageRejected: 0,
    scopeRejected: 0,
    darkRejected: 0,
    trivialRejected: 0,
    gateRun: 0,
    gateNoTransition: 0,
    gateEnvError: 0,
    admitted: 0,
  };
}

/** Mine, scope-filter and screen candidates (shells git). Populates `funnel` in place. */
export function mineCandidates(
  repo: string,
  opts: MiningOptions,
  funnel: AdmissionFunnel,
): Candidate[] {
  const commits = listWindowCommits(repo, opts);
  funnel.mined = commits.length;
  const df = sourceDocumentFrequency(repo, opts.ref);
  const candidates: Candidate[] = [];
  for (const bare of commits) {
    const mined = mineOne(repo, bare, opts, df);
    if (typeof mined === "string") funnel[mined] += 1;
    else candidates.push(mined);
  }
  return candidates;
}

function mineOne(
  repo: string,
  bare: CommitInfo,
  opts: MiningOptions,
  df: DocumentFrequency,
): Candidate | RejectStage {
  if (shouldRejectByMessage(bare.subject)) return "messageRejected";
  if (!bare.parent) return "scopeRejected";
  const commit = loadCommitChanges(repo, bare);
  const partition = partitionChangedFiles(commit.changes);
  if (!passesScope(partition, commit.changes, opts)) return "scopeRejected";
  const candidate = buildCandidate(repo, commit, partition, df);
  const verdict = screenVerdict(candidate.hardness, opts.minDark);
  return verdict === "pass" ? candidate : VERDICT_STAGE[verdict];
}

function buildCandidate(
  repo: string,
  commit: CommitInfo,
  partition: FilePartition,
  df: DocumentFrequency,
): Candidate {
  const parentCommit = commit.parent!;
  const { testFiles, sourceFiles: editFiles } = partition;
  const goldDiff = diffForPaths(repo, commit.sha, editFiles);
  const files = screenCommit(repo, { sha: commit.sha, parentCommit, testFiles, editFiles, goldDiff }, df);
  const lockfiles = lockfilesAt(repo, parentCommit);
  return {
    commit,
    parentCommit,
    testFiles,
    editFiles,
    testPatchDiff: diffForPaths(repo, commit.sha, testFiles),
    goldDiff,
    stratum: stratumOf(files),
    hardness: hardnessFeatures(files),
    lockfiles,
    lockfileHash: lockfileHashAt(repo, parentCommit, lockfiles),
  };
}

function lockfileHashAt(repo: string, commit: string, lockfiles: readonly string[]): string {
  const hash = createHash("sha1");
  for (const [path, blob] of readBlobs(repo, commit, lockfiles)) hash.update(`${path}\0${blob}\0`);
  return hash.digest("hex").slice(0, 12);
}
