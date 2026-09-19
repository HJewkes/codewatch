import type { ParsedFile } from "@titan-design/code-parser";
import { computeMetrics } from "./metrics.js";
import { computeSourceMetrics } from "./source-metrics.js";
import { computeDeadCodeMetrics } from "./dead-code.js";
import { computeGrowthRiskMetrics } from "./growth-risk.js";
import { computeChangeCoupling, type ChurnEntry } from "@titan-design/code-graph/history";
import { computeTestCoverageOwnership, loadHistoryMetrics } from "./history-adapter.js";
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
   * 30, 90 and 180 days; the primary window is always included. Lets
   * the dashboard switcher resolve 30/90/180 instead of snapping to one window.
   */
  churnWindows?: number[];
  /**
   * Also store an all-time `lifetime` window (churn/ownership over full git
   * history, no `--since` bound) so codewatch can audit a cold external repo
   * whose activity in any rolling window is thin relative to its whole life.
   */
  includeLifetime?: boolean;
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
  const history = input.computeChurn
    ? loadHistoryMetrics(nodeList, input.idRoot, {
        churnWindowDays: input.churnWindowDays,
        churnWindows: input.churnWindows,
        includeLifetime: input.includeLifetime,
      })
    : null;
  out.push(...(history?.metrics ?? []));
  out.push(
    ...computeTestCoverage(nodeList, history?.primaryEntries ?? null, input.churnWindowDays),
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
): GraphMetric[] {
  const coEditPairs = entries
    ? computeChangeCoupling(entries, { knownPaths: collectFileIds(nodes) }).pairs
    : [];
  const links = linkTestsToSources(nodes, coEditPairs);
  if (links.length === 0) return [];
  const out = testCoverageCountMetrics(links);
  if (entries) {
    out.push(...computeTestCoverageOwnership(entries, links, { windowDays }));
  }
  return out;
}
