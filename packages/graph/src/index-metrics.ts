import type { ParsedFile } from "@code-style/core";
import { computeMetrics } from "./metrics.js";
import { computeSourceMetrics } from "./source-metrics.js";
import { aggregateChurn, loadChurnEntries } from "./churn.js";
import { computeOwnershipMetrics } from "./ownership.js";
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
  churnWindowDays?: number;
}

function collectFileIds(nodes: Iterable<GraphNode>): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.kind === "file") out.add(n.id);
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
    ...computeSourceMetrics(input.parsedFiles, (p) => fileId(input.idRoot, p)),
    ...input.reusedSourceMetrics,
  ];
  if (input.computeChurn) {
    const knownFileIds = collectFileIds(input.nodes.values());
    const entries = loadChurnEntries({
      repoRoot: input.idRoot,
      windowDays: input.churnWindowDays,
      knownFileIds,
    });
    if (entries !== null) {
      out.push(
        ...aggregateChurn(entries, input.churnWindowDays ?? 30, knownFileIds),
        ...computeOwnershipMetrics(entries, {
          windowDays: input.churnWindowDays,
          knownFileIds,
        }),
      );
    }
  }
  return out;
}
