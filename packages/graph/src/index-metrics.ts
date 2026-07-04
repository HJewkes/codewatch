import type { ParsedFile } from "@codewatch/core";
import { computeMetrics } from "./metrics.js";
import { computeSourceMetrics } from "./source-metrics.js";
import { computeDeadCodeMetrics } from "./dead-code.js";
import { computeGrowthRiskMetrics } from "./growth-risk.js";
import {
  aggregateChurnWindows,
  computeRecencyWindows,
  entriesWithin,
  loadChurnEntries,
  loadFileFirstSeen,
  type ChurnEntry,
} from "./churn.js";
import { computeChangeCoupling } from "./change-coupling.js";
import { computeOwnershipMetrics, computeTestCoverageOwnership } from "./ownership.js";
import { linkTestsToSources, testCoverageCountMetrics } from "./test-linker.js";
import { fileId } from "./extractors/ids.js";
import type { GraphEdge, GraphMetric, GraphNode } from "./types.js";

export interface IndexerMetricsInput {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  /** Files (re)parsed this run — source metrics are computed fresh for these. */
  parsedFiles: ParsedFile[];
  /** Source metrics carried forward verbatim for reused (unchanged) files. */
  reusedSourceMetrics: GraphMetric[];
  idRoot: string;
  computeChurn: boolean;
  /** Primary window: scopes ownership, coupling, coverage, and fitness recency. */
  churnWindowDays?: number;
  /**
   * Windows to store churn (and per-window recency) for. Defaults to
   * {@link DEFAULT_CHURN_WINDOWS}; the primary window is always included. Lets
   * the dashboard switcher resolve 30/90/180 instead of snapping to one window.
   */
  churnWindows?: number[];
}

/** Windows the dashboard switcher offers; churn is stored for each by default. */
export const DEFAULT_CHURN_WINDOWS = [30, 90, 180];

/** Effective, de-duped, sorted window set — always includes the primary window. */
function resolveChurnWindows(
  requested: number[] | undefined,
  primaryWindow: number,
): number[] {
  const base = requested && requested.length > 0 ? requested : DEFAULT_CHURN_WINDOWS;
  return [...new Set([primaryWindow, ...base])]
    .filter((w) => w > 0)
    .sort((a, b) => a - b);
}

/**
 * Age-discount metrics for the files that churned in each window, from their
 * first-commit dates. Skipped silently when git can't supply first-seen dates
 * (the hotspot score then falls back to an undiscounted churn × complexity).
 */
function recencyMetrics(
  idRoot: string,
  churnMetrics: readonly GraphMetric[],
  windows: readonly number[],
  knownFileIds: ReadonlySet<string> | undefined,
  nowEpoch: number,
): GraphMetric[] {
  const churnedByWindow = new Map<number, ReadonlySet<string>>();
  for (const w of windows) {
    const ids = new Set(
      churnMetrics.filter((m) => m.name === `churn_${w}d`).map((m) => m.nodeId),
    );
    if (ids.size > 0) churnedByWindow.set(w, ids);
  }
  if (churnedByWindow.size === 0) return [];
  // Fall back to an empty map when git can't supply first-seen dates: recency
  // still emits (=1) for every churned file, so scary-hotspots keeps firing.
  const firstSeen = loadFileFirstSeen({ repoRoot: idRoot, knownFileIds }) ?? new Map<string, number>();
  return computeRecencyWindows(firstSeen, churnedByWindow, nowEpoch);
}

function collectFileIds(nodes: Iterable<GraphNode>): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.kind === "file") out.add(n.id);
  }
  return out;
}

/**
 * Map each file id to the names of the `symbol` nodes it declares, so
 * `computeSourceMetrics` can attach per-function complexity (C-58). Reflects the
 * assembled node set (parsed + reused symbol nodes alike) — including the
 * non-exported function/class nodes of model B (C-64) — so per-symbol complexity
 * is emitted for exactly the names that have a symbol node.
 */
function symbolNamesByFile(
  nodes: Iterable<GraphNode>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (n.kind !== "symbol" || !n.parentId) continue;
    const bucket = out.get(n.parentId);
    if (bucket) bucket.add(n.name);
    else out.set(n.parentId, new Set([n.name]));
  }
  return out;
}

/**
 * Assemble the metric set for a snapshot: graph-wide degree metrics over the
 * full node/edge set, freshly-computed source metrics for (re)parsed files,
 * reused source metrics carried forward for unchanged files, and git churn /
 * ownership. Everything but the reused source metrics is recomputed over the
 * full set, so the result matches a full index regardless of how much was reused.
 */
export function buildIndexerMetrics(input: IndexerMetricsInput): GraphMetric[] {
  const nodeList = [...input.nodes.values()];
  const edgeList = [...input.edges.values()];
  const out: GraphMetric[] = [
    ...computeMetrics(nodeList, edgeList),
    ...computeSourceMetrics(
      input.parsedFiles,
      (p) => fileId(input.idRoot, p),
      symbolNamesByFile(nodeList),
    ),
    ...computeDeadCodeMetrics(input.parsedFiles, (p) => fileId(input.idRoot, p)),
    ...computeGrowthRiskMetrics(input.parsedFiles, (p) => fileId(input.idRoot, p)),
    ...input.reusedSourceMetrics,
  ];
  let entries: readonly ChurnEntry[] | null = null;
  let knownFileIds: Set<string> | undefined;
  if (input.computeChurn) {
    knownFileIds = collectFileIds(input.nodes.values());
    const primaryWindow = input.churnWindowDays ?? 30;
    const windows = resolveChurnWindows(input.churnWindows, primaryWindow);
    const maxWindow = windows[windows.length - 1]!;
    // Load the widest window once; slice it per window for churn/recency.
    const wide = loadChurnEntries({
      repoRoot: input.idRoot,
      windowDays: maxWindow,
      knownFileIds,
    });
    if (wide !== null) {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const churnMetrics = aggregateChurnWindows(wide, windows, nowEpoch, knownFileIds);
      // Ownership, coupling, and coverage stay scoped to the primary window.
      entries =
        primaryWindow === maxWindow ? wide : entriesWithin(wide, primaryWindow, nowEpoch);
      out.push(
        ...churnMetrics,
        ...computeOwnershipMetrics(entries, {
          windowDays: input.churnWindowDays,
          knownFileIds,
        }),
        ...recencyMetrics(input.idRoot, churnMetrics, windows, knownFileIds, nowEpoch),
      );
    }
  }
  out.push(
    ...computeTestCoverage(nodeList, entries, input.churnWindowDays, knownFileIds),
  );
  return out;
}

/**
 * Two-pass test↔source linker outputs: per-source coverage counts (always) and,
 * when churn is available, the bus-factor / top-author-share of each source's
 * test coverage. Path-convention links need no churn; co-edit supplementation
 * and the ownership split reuse the already-loaded churn entries.
 */
function computeTestCoverage(
  nodes: readonly GraphNode[],
  entries: readonly ChurnEntry[] | null,
  windowDays: number | undefined,
  knownFileIds: ReadonlySet<string> | undefined,
): GraphMetric[] {
  const coEditPairs = entries
    ? computeChangeCoupling(entries, { knownFileIds }).pairs
    : [];
  const links = linkTestsToSources(nodes, coEditPairs);
  if (links.length === 0) return [];
  const out = testCoverageCountMetrics(links);
  if (entries) {
    out.push(...computeTestCoverageOwnership(entries, links, { windowDays }));
  }
  return out;
}
