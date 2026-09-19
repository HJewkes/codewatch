// Copy of @titan-design/code-graph's history-recency.ts and history-metrics.ts at titan-platform 6b1876a (code-graph 0.2.0); delete when code-graph exports loadHistoryMetrics (TP-250).
import {
  aggregateChurnWindows,
  authorLinesByPath,
  computeOwnership,
  entriesWithin,
  loadChurnEntries,
  loadFileFirstSeen,
  type ChurnEntry,
  type ChurnWindow,
  type PathChurn,
  summarizeOwnership,
} from "@titan-design/code-graph/history";
import { groupTestsBySource, type TestSourceLink } from "./test-linker.js";
import type { GraphMetric, GraphNode } from "./types.js";

const DAY_SECONDS = 86400;

/** Metric-name suffix for a window: `30d`, `180d`, or `lifetime`. */
export function windowSuffix(window: ChurnWindow): string {
  return window === "lifetime" ? "lifetime" : `${window}d`;
}

/**
 * Age-discount metrics: `recency_{w}` = min(1, age/w) for each file that churned
 * in window `w`, plus one window-independent `file_age_days` per file. Multiplying
 * a hotspot score by recency stops a young file's burst of churn from reading as
 * decay. Recency is emitted (as 1) even when the age is unknown, so a rule that
 * needs every hotspot factor is never silently disabled; `file_age_days` only when known.
 */
export function computeRecencyWindows(
  firstSeen: ReadonlyMap<string, number>,
  churnedIdsByWindow: ReadonlyMap<ChurnWindow, ReadonlySet<string>>,
  nowEpoch: number,
): GraphMetric[] {
  const out: GraphMetric[] = [];
  const ageEmitted = new Set<string>();
  for (const [windowDays, ids] of churnedIdsByWindow) {
    const suffix = windowSuffix(windowDays);
    for (const id of ids) {
      const seen = firstSeen.get(id);
      let recency = 1;
      if (seen !== undefined) {
        const ageDays = Math.max(0, (nowEpoch - seen) / DAY_SECONDS);
        // Lifetime has no window to age against, so its recency stays 1.
        if (windowDays !== "lifetime") recency = Math.min(1, ageDays / windowDays);
        if (!ageEmitted.has(id)) {
          out.push({ nodeId: id, name: "file_age_days", value: Math.round(ageDays), unit: "days" });
          ageEmitted.add(id);
        }
      }
      out.push({ nodeId: id, name: `recency_${suffix}`, value: round3(recency), unit: "ratio" });
    }
  }
  return out;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface HistoryMetricsOptions {
  /** Primary window: scopes ownership. Default 30. */
  churnWindowDays?: number;
  /** Windows to store churn and recency for; default {@link DEFAULT_CHURN_WINDOWS}, primary always included. */
  churnWindows?: number[];
  /** Also store an all-time `lifetime` window over full git history. */
  includeLifetime?: boolean;
  /** Epoch seconds that windows end at; defaults to the current time. */
  nowEpoch?: number;
}

/** Windows the dashboard switcher offers; churn is stored for each by default. */
export const DEFAULT_CHURN_WINDOWS = [30, 90, 180];

/** De-duped, ascending windows including the primary, with `lifetime` last (widest) when requested. */
export function resolveChurnWindows(
  requested: number[] | undefined,
  primaryWindow: number,
  includeLifetime: boolean,
): ChurnWindow[] {
  const base = requested && requested.length > 0 ? requested : DEFAULT_CHURN_WINDOWS;
  const finite = [...new Set([primaryWindow, ...base])].filter((w) => w > 0).sort((a, b) => a - b);
  return includeLifetime ? [...finite, "lifetime"] : finite;
}

export interface LoadedHistory {
  metrics: GraphMetric[];
  /** Churn entries inside the primary window, which also scopes test-coverage linking and ownership. */
  primaryEntries: readonly ChurnEntry[];
}

/**
 * Git-history metrics for a snapshot's file nodes: churn and recency per window,
 * ownership for the primary window (and lifetime when requested). Node ids are
 * the history engine's repo-relative paths, because both are rooted at `idRoot`.
 * Returns [] when git or history is unavailable.
 */
export function buildHistoryMetrics(
  nodes: Iterable<GraphNode>,
  idRoot: string,
  options: HistoryMetricsOptions = {},
): GraphMetric[] {
  return loadHistoryMetrics(nodes, idRoot, options)?.metrics ?? [];
}

/** {@link buildHistoryMetrics} plus the primary-window entries it read; null when git or history is unavailable. */
export function loadHistoryMetrics(
  nodes: Iterable<GraphNode>,
  idRoot: string,
  options: HistoryMetricsOptions = {},
): LoadedHistory | null {
  const knownPaths = collectFileIds(nodes);
  const primaryWindow = options.churnWindowDays ?? 30;
  const windows = resolveChurnWindows(options.churnWindows, primaryWindow, options.includeLifetime === true);
  // Load the widest window once and slice it per window; lifetime sorts widest.
  const wide = loadChurnEntries({ repoRoot: idRoot, windowDays: windows[windows.length - 1]! });
  if (wide === null) return null;
  const nowEpoch = options.nowEpoch ?? Math.floor(Date.now() / 1000);
  const churnByWindow = aggregateChurnWindows(wide, windows, nowEpoch, knownPaths);
  const primaryEntries = windows.at(-1) === primaryWindow ? wide : entriesWithin(wide, primaryWindow, nowEpoch);
  const metrics = [
    ...churnMetrics(churnByWindow),
    ...ownershipMetrics(primaryEntries, primaryWindow, knownPaths),
    ...recencyMetrics(idRoot, churnByWindow, knownPaths, nowEpoch),
  ];
  // Lifetime ownership is the dominant owner over full history; `wide` is full history when lifetime is on.
  if (options.includeLifetime === true) metrics.push(...ownershipMetrics(wide, "lifetime", knownPaths));
  return { metrics, primaryEntries };
}

export function collectFileIds(nodes: Iterable<GraphNode>): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.kind === "file") out.add(n.id);
  }
  return out;
}

/** Name one window's per-path churn as `churn_{w}`, `churn_{w}_commits`, `churn_{w}_authors`. */
export function churnMetrics(churnByWindow: ReadonlyMap<ChurnWindow, ReadonlyMap<string, PathChurn>>): GraphMetric[] {
  const out: GraphMetric[] = [];
  for (const [window, byPath] of churnByWindow) {
    const suffix = windowSuffix(window);
    for (const [nodeId, churn] of byPath) {
      out.push(
        { nodeId, name: `churn_${suffix}`, value: churn.lines, unit: "lines" },
        { nodeId, name: `churn_${suffix}_commits`, value: churn.commits, unit: "count" },
        { nodeId, name: `churn_${suffix}_authors`, value: churn.authors, unit: "count" },
      );
    }
  }
  return out;
}

/** Name ownership as `bus_factor_{w}` and `top_author_share_{w}` (rounded to 3 places). */
export function ownershipMetrics(
  entries: readonly ChurnEntry[],
  window: ChurnWindow,
  knownPaths?: ReadonlySet<string>,
): GraphMetric[] {
  const suffix = windowSuffix(window);
  const out: GraphMetric[] = [];
  for (const [nodeId, owner] of computeOwnership(entries, { knownPaths })) {
    out.push(
      { nodeId, name: `bus_factor_${suffix}`, value: owner.busFactor, unit: "count" },
      { nodeId, name: `top_author_share_${suffix}`, value: round3(owner.topAuthorShare), unit: "ratio" },
    );
  }
  return out;
}

export interface TestCoverageOwnershipOptions {
  /** Window named in the metric suffix. Default 30. */
  windowDays?: ChurnWindow;
  /** Coverage threshold for bus factor (default 0.5 = 50% of churn). */
  busFactorThreshold?: number;
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
  options: TestCoverageOwnershipOptions = {},
): GraphMetric[] {
  const suffix = windowSuffix(options.windowDays ?? 30);
  const testsBySource = groupTestsBySource(links);
  const testIds = new Set<string>();
  for (const tests of testsBySource.values()) {
    for (const t of tests) testIds.add(t);
  }
  const linesByTest = authorLinesByPath(entries, testIds);
  const out: GraphMetric[] = [];
  for (const [nodeId, tests] of testsBySource) {
    const summary = summarizeOwnership(mergeAuthorChurn(tests, linesByTest), options.busFactorThreshold);
    if (summary === null) continue;
    out.push(
      { nodeId, name: `test_bus_factor_${suffix}`, value: summary.busFactor, unit: "count" },
      { nodeId, name: `test_top_author_share_${suffix}`, value: round3(summary.topAuthorShare), unit: "ratio" },
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

/** Recency for files that churned in each window; an unknown first-seen date still yields recency 1. */
function recencyMetrics(
  idRoot: string,
  churnByWindow: ReadonlyMap<ChurnWindow, ReadonlyMap<string, PathChurn>>,
  knownPaths: ReadonlySet<string>,
  nowEpoch: number,
): GraphMetric[] {
  const churnedByWindow = new Map<ChurnWindow, ReadonlySet<string>>();
  for (const [window, byPath] of churnByWindow) {
    if (byPath.size > 0) churnedByWindow.set(window, new Set(byPath.keys()));
  }
  if (churnedByWindow.size === 0) return [];
  const firstSeen = loadFileFirstSeen({ repoRoot: idRoot, knownPaths }) ?? new Map<string, number>();
  return computeRecencyWindows(firstSeen, churnedByWindow, nowEpoch);
}
