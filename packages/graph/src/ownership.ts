import type { ChurnEntry } from "./churn.js";
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
