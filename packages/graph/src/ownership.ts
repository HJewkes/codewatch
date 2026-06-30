import type { ChurnEntry } from "./churn.js";
import { groupTestsBySource, type TestSourceLink } from "./test-linker.js";
import type { GraphMetric } from "./types.js";

export interface OwnershipForFile {
  /** Distinct contributing authors. */
  authors: number;
  /** Fraction of churn (lines) from the single largest contributor (0..1). */
  topAuthorShare: number;
  /** Min number of authors whose combined contribution covers >= 50% of churn. */
  busFactor: number;
}

export interface ComputeOwnershipOptions {
  windowDays?: number;
  knownFileIds?: ReadonlySet<string>;
  /** Coverage threshold for bus_factor (default 0.5 = 50% of churn). */
  busFactorThreshold?: number;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_BUS_FACTOR_THRESHOLD = 0.5;

export function computeOwnershipMetrics(
  entries: readonly ChurnEntry[],
  options: ComputeOwnershipOptions = {},
): GraphMetric[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const threshold =
    options.busFactorThreshold ?? DEFAULT_BUS_FACTOR_THRESHOLD;
  const linesByAuthor = groupByFileAndAuthor(entries, options.knownFileIds);
  const suffix = `${windowDays}d`;
  const out: GraphMetric[] = [];
  for (const [filePath, byAuthor] of linesByAuthor) {
    const summary = summarizeFile(byAuthor, threshold);
    if (summary === null) continue;
    out.push(
      {
        nodeId: filePath,
        name: `bus_factor_${suffix}`,
        value: summary.busFactor,
        unit: "count",
      },
      {
        nodeId: filePath,
        name: `top_author_share_${suffix}`,
        value: round3(summary.topAuthorShare),
        unit: "ratio",
      },
    );
  }
  return out;
}

/**
 * Bus-factor / top-author-share of the *test coverage* for each source, keyed
 * on the source node. Aggregates churn authorship across all test files linked
 * to a source (via the two-pass linker) and summarises it the same way as
 * production ownership — so a file can read as well-spread on production code
 * yet a single-author silo on its tests (or vice versa). Emitted only for
 * sources with at least one linked test that has churn in the window.
 */
export function computeTestCoverageOwnership(
  entries: readonly ChurnEntry[],
  links: readonly TestSourceLink[],
  options: ComputeOwnershipOptions = {},
): GraphMetric[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const threshold =
    options.busFactorThreshold ?? DEFAULT_BUS_FACTOR_THRESHOLD;
  const testsBySource = groupTestsBySource(links);
  const testIds = new Set<string>();
  for (const tests of testsBySource.values()) {
    for (const t of tests) testIds.add(t);
  }
  const linesByTest = groupByFileAndAuthor(entries, testIds);
  const suffix = `${windowDays}d`;
  const out: GraphMetric[] = [];
  for (const [sourceId, tests] of testsBySource) {
    const byAuthor = mergeAuthorChurn(tests, linesByTest);
    const summary = summarizeFile(byAuthor, threshold);
    if (summary === null) continue;
    out.push(
      {
        nodeId: sourceId,
        name: `test_bus_factor_${suffix}`,
        value: summary.busFactor,
        unit: "count",
      },
      {
        nodeId: sourceId,
        name: `test_top_author_share_${suffix}`,
        value: round3(summary.topAuthorShare),
        unit: "ratio",
      },
    );
  }
  return out;
}

/** Sum per-author churn across a set of test files into one author tally. */
function mergeAuthorChurn(
  tests: ReadonlySet<string>,
  linesByTest: ReadonlyMap<string, Map<string, number>>,
): Map<string, number> {
  const byAuthor = new Map<string, number>();
  for (const testId of tests) {
    const fileAuthors = linesByTest.get(testId);
    if (!fileAuthors) continue;
    for (const [author, lines] of fileAuthors) {
      byAuthor.set(author, (byAuthor.get(author) ?? 0) + lines);
    }
  }
  return byAuthor;
}

function groupByFileAndAuthor(
  entries: readonly ChurnEntry[],
  known: ReadonlySet<string> | undefined,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (known && !known.has(e.filePath)) continue;
    const lines = e.added + e.deleted;
    if (lines === 0) continue;
    let byAuthor = out.get(e.filePath);
    if (!byAuthor) {
      byAuthor = new Map();
      out.set(e.filePath, byAuthor);
    }
    byAuthor.set(e.author, (byAuthor.get(e.author) ?? 0) + lines);
  }
  return out;
}

function summarizeFile(
  byAuthor: ReadonlyMap<string, number>,
  threshold: number,
): OwnershipForFile | null {
  let total = 0;
  for (const v of byAuthor.values()) total += v;
  if (total === 0) return null;
  const sorted = [...byAuthor.values()].sort((a, b) => b - a);
  const topAuthorShare = sorted[0]! / total;
  const busFactor = minAuthorsToReach(sorted, total, threshold);
  return { authors: sorted.length, topAuthorShare, busFactor };
}

function minAuthorsToReach(
  sortedDesc: readonly number[],
  total: number,
  threshold: number,
): number {
  let acc = 0;
  for (let i = 0; i < sortedDesc.length; i++) {
    acc += sortedDesc[i]!;
    if (acc / total >= threshold) return i + 1;
  }
  return sortedDesc.length;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
