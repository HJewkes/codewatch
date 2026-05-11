import type { ChurnEntry } from "./churn.js";

export interface CoEditPair {
  fileA: string;
  fileB: string;
  /** Commits in which both files changed. */
  count: number;
  /** Most recent commits (up to maxCommitsPerPair). */
  commits: string[];
}

export interface ComputeChangeCouplingOptions {
  /** Skip pairs that co-occur in fewer than this many commits. Default 2. */
  minCount?: number;
  /** Truncate the commits sample per pair. Default 10. */
  maxCommitsPerPair?: number;
  /**
   * Skip commits touching more than this many files (sweeping refactors,
   * mass renames, etc.). Default 50 — beyond that, the O(n²) pair explosion
   * is signal-poor and noisy.
   */
  largeCommitThreshold?: number;
  /** Filter file paths to this set before pairing. */
  knownFileIds?: ReadonlySet<string>;
}

interface CommitMeta {
  commit: string;
  files: string[];
}

interface PairAccum {
  count: number;
  commits: string[];
}

const DEFAULT_MIN_COUNT = 2;
const DEFAULT_MAX_COMMITS_PER_PAIR = 10;
const DEFAULT_LARGE_COMMIT_THRESHOLD = 50;

export function computeChangeCoupling(
  entries: readonly ChurnEntry[],
  options: ComputeChangeCouplingOptions = {},
): CoEditPair[] {
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT;
  const maxCommits =
    options.maxCommitsPerPair ?? DEFAULT_MAX_COMMITS_PER_PAIR;
  const largeThreshold =
    options.largeCommitThreshold ?? DEFAULT_LARGE_COMMIT_THRESHOLD;

  const byCommit = groupByCommit(entries, options.knownFileIds);
  const pairs = new Map<string, PairAccum>();
  for (const meta of byCommit.values()) {
    if (meta.files.length < 2 || meta.files.length > largeThreshold) continue;
    accumulatePairs(meta, pairs, maxCommits);
  }
  return finalize(pairs, minCount);
}

function groupByCommit(
  entries: readonly ChurnEntry[],
  known: ReadonlySet<string> | undefined,
): Map<string, CommitMeta> {
  const out = new Map<string, CommitMeta>();
  for (const e of entries) {
    if (known && !known.has(e.filePath)) continue;
    let meta = out.get(e.commit);
    if (!meta) {
      meta = { commit: e.commit, files: [] };
      out.set(e.commit, meta);
    }
    if (!meta.files.includes(e.filePath)) meta.files.push(e.filePath);
  }
  return out;
}

function accumulatePairs(
  meta: CommitMeta,
  pairs: Map<string, PairAccum>,
  maxCommits: number,
): void {
  const files = [...meta.files].sort();
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const key = `${files[i]!}\t${files[j]!}`;
      let acc = pairs.get(key);
      if (!acc) {
        acc = { count: 0, commits: [] };
        pairs.set(key, acc);
      }
      acc.count++;
      if (acc.commits.length < maxCommits) acc.commits.push(meta.commit);
    }
  }
}

function finalize(
  pairs: ReadonlyMap<string, PairAccum>,
  minCount: number,
): CoEditPair[] {
  const out: CoEditPair[] = [];
  for (const [key, acc] of pairs) {
    if (acc.count < minCount) continue;
    const [a, b] = key.split("\t");
    out.push({ fileA: a!, fileB: b!, count: acc.count, commits: acc.commits });
  }
  return out.sort(comparePairs);
}

function comparePairs(a: CoEditPair, b: CoEditPair): number {
  if (b.count !== a.count) return b.count - a.count;
  if (a.fileA !== b.fileA) return a.fileA < b.fileA ? -1 : 1;
  return a.fileB < b.fileB ? -1 : a.fileB > b.fileB ? 1 : 0;
}

/**
 * For a specific seed file, return the files most coupled to it, sorted by
 * co-edit count desc. Excludes the seed from the output.
 */
export function couplingFor(
  pairs: readonly CoEditPair[],
  seed: string,
): Array<{ partner: string; count: number; commits: string[] }> {
  const out: Array<{ partner: string; count: number; commits: string[] }> = [];
  for (const p of pairs) {
    if (p.fileA === seed) {
      out.push({ partner: p.fileB, count: p.count, commits: p.commits });
    } else if (p.fileB === seed) {
      out.push({ partner: p.fileA, count: p.count, commits: p.commits });
    }
  }
  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.partner < b.partner ? -1 : a.partner > b.partner ? 1 : 0;
  });
  return out;
}
